import {
  Table,
  Column,
  Model,
  DataType,
  ForeignKey,
  BelongsTo,
} from 'sequelize-typescript';
import { Order } from './order.entity';

@Table({
  tableName: 'order_items',
  timestamps: false,
})
export class OrderItem extends Model<OrderItem> {
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  id: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  description: string;

  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  quantity: number;

  @Column({
    type: DataType.DECIMAL(10, 2),
    allowNull: false,
  })
  unitPrice: number;

  @Column({
    type: DataType.DECIMAL(10, 2),
  })
  subtotal: number;

  @ForeignKey(() => Order)
  @Column({
    type: DataType.UUID,
  })
  orderId: string;

  @BelongsTo(() => Order)
  order: Order;
}