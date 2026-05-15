import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn,
} from 'typeorm';

@Entity('licencia_estado')
export class LicenciaEstado {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  licenseId: string;

  @Column({ length: 20 })
  plan: string;

  @Column({ default: 100 })
  maxClientes: number;

  @Column({ length: 200, nullable: true })
  issuedTo: string;

  @Column({ length: 64, nullable: true })
  machineId: string;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  lastOnlineValidatedAt: Date;

  // valid | grace | locked | expired
  @Column({ length: 20, default: 'pending' })
  estado: string;

  // Almacenamos el JWT completo para re-verificar sin env
  @Column({ type: 'text' })
  licenseJwt: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
