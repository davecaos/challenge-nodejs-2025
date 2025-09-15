import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Order, OrderStatus } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { CreateOrderDto } from './dto/create-order.dto';
import { Op } from 'sequelize';

@Injectable()
export class OrdersRepository {
  constructor(
    @InjectModel(Order)
    private orderModel: typeof Order,
    @InjectModel(OrderItem)
    private orderItemModel: typeof OrderItem,
  ) {}

  async findAll(): Promise<Order[]> {
    return this.orderModel.findAll({
      where: {
        status: {
          [Op.ne]: OrderStatus.DELIVERED,
        },
      },
      include: [OrderItem],
      order: [['createdAt', 'DESC']],
    });
  }

  async findById(id: string): Promise<Order> {
    return this.orderModel.findByPk(id, {
      include: [OrderItem],
    });
  }

  async create(createOrderDto: CreateOrderDto): Promise<Order> {
    const totalAmount = createOrderDto.items.reduce(
      (sum, item) => sum + item.quantity * item.unitPrice,
      0,
    );

    const order = await this.orderModel.create({
      clientName: createOrderDto.clientName,
      status: OrderStatus.INITIATED,
      totalAmount,
    });

    const items = createOrderDto.items.map((item) => ({
      ...item,
      orderId: order.id,
      subtotal: item.quantity * item.unitPrice,
    }));

    await this.orderItemModel.bulkCreate(items);

    return this.findById(order.id);
  }

  async updateStatus(id: string, status: OrderStatus): Promise<Order> {
    const order = await this.findById(id);
    if (order) {
      order.status = status;
      await order.save();
    }
    return order;
  }

  async delete(id: string): Promise<void> {
    await this.orderItemModel.destroy({
      where: { orderId: id },
    });
    await this.orderModel.destroy({
      where: { id },
    });
  }

  async deleteOldOrders(days: number): Promise<number> {
    const dateThreshold = new Date();
    dateThreshold.setDate(dateThreshold.getDate() - days);

    const orders = await this.orderModel.findAll({
      where: {
        createdAt: {
          [Op.lt]: dateThreshold,
        },
        status: OrderStatus.DELIVERED,
      },
    });

    for (const order of orders) {
      await this.delete(order.id);
    }

    return orders.length;
  }
}