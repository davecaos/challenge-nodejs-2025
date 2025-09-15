import { Injectable, NotFoundException, BadRequestException, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import Redis from 'ioredis';
import { OrdersRepository } from './orders.repository';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderResponseDto } from './dto/order-response.dto';
import { Order, OrderStatus } from './entities/order.entity';

@Injectable()
export class OrdersService {
  private redis: Redis;
  private readonly CACHE_KEY = 'orders:all';

  constructor(
    private readonly ordersRepository: OrdersRepository,
    private readonly configService: ConfigService,
  ) {
    this.redis = new Redis({
      host: this.configService.get('redis.host'),
      port: this.configService.get('redis.port'),
    });
  }

  async findAll(): Promise<OrderResponseDto[]> {
    // Try to get from cache
    const cached = await this.redis.get(this.CACHE_KEY);
    if (cached) {
      return JSON.parse(cached);
    }

    // Get from database
    const orders = await this.ordersRepository.findAll();
    const orderDtos = this.mapOrdersToDto(orders);

    // Cache for 30 seconds
    await this.redis.setex(
      this.CACHE_KEY,
      this.configService.get('redis.ttl'),
      JSON.stringify(orderDtos),
    );

    return orderDtos;
  }

  async findOne(id: string): Promise<OrderResponseDto> {
    const order = await this.ordersRepository.findById(id);
    if (!order) {
      throw new NotFoundException(`Order with ID ${id} not found`);
    }
    return this.mapOrderToDto(order);
  }

  async create(createOrderDto: CreateOrderDto): Promise<OrderResponseDto> {
    const order = await this.ordersRepository.create(createOrderDto);
    
    // Invalidate cache
    await this.redis.del(this.CACHE_KEY);
    
    return this.mapOrderToDto(order);
  }

  async advanceStatus(id: string): Promise<OrderResponseDto> {
    const order = await this.ordersRepository.findById(id);
    if (!order) {
      throw new NotFoundException(`Order with ID ${id} not found`);
    }

    let newStatus: OrderStatus;

    switch (order.status) {
      case OrderStatus.INITIATED:
        newStatus = OrderStatus.SENT;
        break;
      case OrderStatus.SENT:
        newStatus = OrderStatus.DELIVERED;
        break;
      case OrderStatus.DELIVERED:
        throw new BadRequestException('Order is already delivered');
      default:
        throw new BadRequestException('Invalid order status');
    }

    const updatedOrder = await this.ordersRepository.updateStatus(id, newStatus);

    // If delivered, delete from database and cache
    if (newStatus === OrderStatus.DELIVERED) {
      await this.ordersRepository.delete(id);
      await this.redis.del(this.CACHE_KEY);
      return this.mapOrderToDto(updatedOrder);
    }

    // Invalidate cache
    await this.redis.del(this.CACHE_KEY);

    return this.mapOrderToDto(updatedOrder);
  }

  // Scheduled job to clean old delivered orders (runs daily at midnight)
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleOldOrders() {
    console.log('Running scheduled job to clean old orders...');
    const deletedCount = await this.ordersRepository.deleteOldOrders(30);
    console.log(`Deleted ${deletedCount} old orders`);
  }

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

  private mapOrdersToDto(orders: Order[]): OrderResponseDto[] {
    return orders.map((order) => this.mapOrderToDto(order));
  }
}