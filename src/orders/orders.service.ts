import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as Redis from 'ioredis';
import { OrdersRepository } from './orders.repository';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderResponseDto } from './dto/order-response.dto';
import { Order, OrderStatus } from './entities/order.entity';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);
  private redis: Redis.Redis;
  private readonly CACHE_KEY = 'orders:all';
  private readonly CACHE_TTL: number;

  constructor(
    private readonly ordersRepository: OrdersRepository,
    private readonly configService: ConfigService,
  ) {
    // Initialize Redis connection
    this.redis = new Redis.Redis({
      host: this.configService.get<string>('redis.host'),
      port: this.configService.get<number>('redis.port'),
      retryStrategy: (times: number) => {
        // Reconnect after
        return Math.min(times * 50, 2000);
      },
    });

    // Get cache TTL from config (default 30 seconds)
    this.CACHE_TTL = this.configService.get<number>('redis.ttl', 30);

    // Handle Redis connection events
    this.redis.on('connect', () => {
      this.logger.log('Redis connected successfully');
    });

    this.redis.on('error', (error) => {
      this.logger.error('Redis connection error:', error);
    });
  }

  /**
   * Get all orders with status different from 'delivered'
   * Results are cached in Redis for 30 seconds
   */
  async findAll(): Promise<OrderResponseDto[]> {
    try {
      // Try to get from cache first
      const cached = await this.redis.get(this.CACHE_KEY);
      
      if (cached) {
        this.logger.debug('Returning cached orders');
        return JSON.parse(cached);
      }

      // If not in cache, get from database
      this.logger.debug('Fetching orders from database');
      const orders = await this.ordersRepository.findAll();
      const orderDtos = this.mapOrdersToDto(orders);

      // Cache the results for 30 seconds
      await this.redis.setex(
        this.CACHE_KEY,
        this.CACHE_TTL,
        JSON.stringify(orderDtos),
      );

      this.logger.log(`Cached ${orderDtos.length} orders for ${this.CACHE_TTL} seconds`);
      return orderDtos;
      
    } catch (error) {
      // If Redis fails, still return data from database
      if (error.message.includes('Redis')) {
        this.logger.warn('Redis error, falling back to database only', error);
        const orders = await this.ordersRepository.findAll();
        return this.mapOrdersToDto(orders);
      }
      throw error;
    }
  }

  /**
   * Get a single order by ID with all its details
   */
  async findOne(id: string): Promise<OrderResponseDto> {
    // Validate UUID format
    if (!this.isValidUUID(id)) {
      throw new BadRequestException('Invalid order ID format');
    }

    const order = await this.ordersRepository.findById(id);
    
    if (!order) {
      throw new NotFoundException(`Order with ID ${id} not found`);
    }

    this.logger.debug(`Retrieved order ${id}`);
    return this.mapOrderToDto(order);
  }

  /**
   * Create a new order with status 'initiated'
   */
  async create(createOrderDto: CreateOrderDto): Promise<OrderResponseDto> {
    // Validate that there's at least one item
    if (!createOrderDto.items || createOrderDto.items.length === 0) {
      throw new BadRequestException('Order must have at least one item');
    }

    // Validate item prices and quantities
    for (const item of createOrderDto.items) {
      if (item.quantity <= 0) {
        throw new BadRequestException('Item quantity must be greater than 0');
      }
      if (item.unitPrice < 0) {
        throw new BadRequestException('Item price cannot be negative');
      }
    }

    try {
      // Create the order in database
      const order = await this.ordersRepository.create(createOrderDto);
      
      // Invalidate cache after creating new order
      await this.invalidateCache();
      
      this.logger.log(`Created new order ${order.id} for client ${order.clientName}`);
      return this.mapOrderToDto(order);
      
    } catch (error) {
      this.logger.error('Error creating order:', error);
      throw new BadRequestException('Failed to create order');
    }
  }

  /**
   * Advance order status through the workflow:
   * initiated → sent → delivered
   * When order reaches 'delivered', it's removed from database
   */
  async advanceStatus(id: string): Promise<OrderResponseDto> {
    // Validate UUID format
    if (!this.isValidUUID(id)) {
      throw new BadRequestException('Invalid order ID format');
    }

    // Get the current order
    const order = await this.ordersRepository.findById(id);
    
    if (!order) {
      throw new NotFoundException(`Order with ID ${id} not found`);
    }

    // Determine the next status
    let newStatus: OrderStatus;
    let message: string;

    switch (order.status) {
      case OrderStatus.INITIATED:
        newStatus = OrderStatus.SENT;
        message = 'Order has been sent to kitchen';
        break;
        
      case OrderStatus.SENT:
        newStatus = OrderStatus.DELIVERED;
        message = 'Order has been delivered';
        break;
        
      case OrderStatus.DELIVERED:
        throw new BadRequestException('Order is already delivered and cannot be advanced further');
        
      default:
        throw new BadRequestException(`Invalid order status: ${order.status}`);
    }

    // Update the order status
    const updatedOrder = await this.ordersRepository.updateStatus(id, newStatus);
    this.logger.log(`Order ${id} status changed from ${order.status} to ${newStatus}`);

    // If the order is delivered, remove it from database and cache
    if (newStatus === OrderStatus.DELIVERED) {
      // Create a copy of the order before deletion for response
      const orderDto = this.mapOrderToDto(updatedOrder);
      
      // Delete from database
      await this.ordersRepository.delete(id);
      this.logger.log(`Delivered order ${id} has been removed from database`);
      
      // Invalidate cache
      await this.invalidateCache();
      
      return orderDto;
    }

    // For non-delivered status changes, just invalidate cache
    await this.invalidateCache();
    
    return this.mapOrderToDto(updatedOrder);
  }

  /**
   * Scheduled job to clean old delivered orders
   * Runs every day at midnight
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleOldOrdersCleanup() {
    this.logger.log('Starting scheduled cleanup of old delivered orders...');
    
    try {
      // Delete orders older than 30 days
      const deletedCount = await this.ordersRepository.deleteOldOrders(30);
      
      if (deletedCount > 0) {
        this.logger.log(`Successfully deleted ${deletedCount} old delivered orders`);
        await this.invalidateCache();
      } else {
        this.logger.log('No old orders to delete');
      }
    } catch (error) {
      this.logger.error('Error during scheduled cleanup:', error);
    }
  }

  /**
   * Clear all cache entries (utility method)
   */
  async clearCache(): Promise<void> {
    try {
      await this.redis.del(this.CACHE_KEY);
      this.logger.log('Cache cleared successfully');
    } catch (error) {
      this.logger.error('Error clearing cache:', error);
    }
  }

  /**
   * Private helper methods
   */

  /**
   * Invalidate the cache
   */
  private async invalidateCache(): Promise<void> {
    try {
      await this.redis.del(this.CACHE_KEY);
      this.logger.debug('Cache invalidated');
    } catch (error) {
      // Log error but don't throw - cache invalidation shouldn't break the flow
      this.logger.warn('Failed to invalidate cache:', error);
    }
  }

  /**
   * Map a single Order entity to OrderResponseDto
   */
  private mapOrderToDto(order: Order): OrderResponseDto {
    return {
      id: order.id,
      clientName: order.clientName,
      status: order.status,
      totalAmount: Number(order.totalAmount),
      items: order.items?.map((item) => ({
        id: item.id,
        description: item.description,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
        subtotal: Number(item.subtotal),
      })) || [],
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }

  /**
   * Map multiple Order entities to OrderResponseDto array
   */
  private mapOrdersToDto(orders: Order[]): OrderResponseDto[] {
    return orders.map((order) => this.mapOrderToDto(order));
  }

  /**
   * Validate UUID format
   */
  private isValidUUID(uuid: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
  }

  /**
   * Cleanup method called when module is destroyed
   */
  async onModuleDestroy() {
    await this.redis.quit();
    this.logger.log('Redis connection closed');
  }
}