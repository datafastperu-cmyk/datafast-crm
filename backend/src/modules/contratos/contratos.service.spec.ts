import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { ContratosService } from './contratos.service';
import { ContratoRepository } from './repositories/contrato.repository';
import { PlanesService } from '../planes/planes.service';
import { AuditoriaService } from '../auth/auditoria.service';
import { ConfigService } from '@nestjs/config';
import { EstadoContrato } from './entities/contrato.entity';
import { TipoQueue } from '../planes/entities/plan.entity';

const mockUser = { sub:'u-001', email:'admin@test.pe', empresaId:'emp-001', roles:['Administrador'], permisos:[], nombreCompleto:'Admin', tema:'dark' };
const mockPlan = { id:'plan-001', empresaId:'emp-001', nombre:'Plan 30 Mbps', activo:true, precio:85.00, tipoQueue:TipoQueue.SIMPLE_QUEUE };
const mockContrato = { id:'cnt-001', empresaId:'emp-001', clienteId:'cli-001', planId:'plan-001', numeroContrato:'CNT-2024-000001', estado:EstadoContrato.PENDIENTE_INSTALACION, ipAsignada:'192.168.1.2', segmentoId:'seg-001', deudaTotal:0, deletedAt:null };
const mockSegmento = { id:'seg-001', redCidr:'192.168.1.0/24', gateway:'192.168.1.1', ipsReservadas:['192.168.1.1'], activo:true };

const mockRepo = { create:jest.fn(d=>({...mockContrato,...d})), save:jest.fn(async c=>({...mockContrato,...c})), update:jest.fn(), findById:jest.fn(), findByClienteId:jest.fn(), softDelete:jest.fn(), findAllPaginated:jest.fn(), findCompleto:jest.fn(), findSegmento:jest.fn(), getIpsUsadas:jest.fn(), getIpsReservadas:jest.fn(), asignarIp:jest.fn(), liberarIp:jest.fn(), ipYaAsignada:jest.fn(), generarNumeroContrato:jest.fn(), guardarHistorial:jest.fn(), getHistorial:jest.fn(), findMorososParaCorte:jest.fn(), findParaReactivar:jest.fn(), findProrrogasVencidas:jest.fn(), getResumen:jest.fn() };
const mockPlanesSvc = { findOne:jest.fn() };
const mockAuditoria = { log:jest.fn(), logCreate:jest.fn(), logUpdate:jest.fn(), logDelete:jest.fn() };
const mockConfig = { get:jest.fn((k,d)=>d??1) };

describe('ContratosService', () => {
  let service: ContratosService;
  beforeEach(async () => {
    const m = await Test.createTestingModule({ providers:[ContratosService,{provide:ContratoRepository,useValue:mockRepo},{provide:PlanesService,useValue:mockPlanesSvc},{provide:AuditoriaService,useValue:mockAuditoria},{provide:ConfigService,useValue:mockConfig}] }).compile();
    service = m.get(ContratosService);
  });
  afterEach(()=>jest.clearAllMocks());

  describe('create()', () => {
    it('crea contrato y asigna IP automática', async () => {
      mockPlanesSvc.findOne.mockResolvedValue(mockPlan);
      mockRepo.findByClienteId.mockResolvedValue([]);
      mockRepo.generarNumeroContrato.mockResolvedValue('CNT-2024-000001');
      mockRepo.findSegmento.mockResolvedValue(mockSegmento);
      mockRepo.getIpsUsadas.mockResolvedValue(['192.168.1.1']);
      mockRepo.getIpsReservadas.mockResolvedValue(['192.168.1.1']);
      mockRepo.ipYaAsignada.mockResolvedValue(false);
      mockRepo.save.mockResolvedValue(mockContrato);
      mockRepo.asignarIp.mockResolvedValue({});
      const result = await service.create({ clienteId:'cli-001', planId:'plan-001', fechaInicio:'2024-01-15', segmentoId:'seg-001' } as any, mockUser as any);
      expect(result.numeroContrato).toBe('CNT-2024-000001');
      expect(mockRepo.asignarIp).toHaveBeenCalled();
    });

    it('rechaza plan inactivo', async () => {
      mockPlanesSvc.findOne.mockResolvedValue({ ...mockPlan, activo:false });
      await expect(service.create({ clienteId:'x', planId:'p', fechaInicio:'2024-01-01' } as any, mockUser as any)).rejects.toThrow(BadRequestException);
    });

    it('rechaza duplicado de plan por cliente', async () => {
      mockPlanesSvc.findOne.mockResolvedValue(mockPlan);
      mockRepo.findByClienteId.mockResolvedValue([{ planId:'plan-001', estado:EstadoContrato.ACTIVO, numeroContrato:'CNT-2024-000001' }]);
      await expect(service.create({ clienteId:'cli-001', planId:'plan-001', fechaInicio:'2024-01-15' } as any, mockUser as any)).rejects.toThrow(ConflictException);
    });
  });

  describe('cambiarEstado()', () => {
    it('PENDIENTE_INSTALACION → ACTIVO', async () => {
      mockRepo.findById.mockResolvedValueOnce(mockContrato).mockResolvedValueOnce({ ...mockContrato, estado:EstadoContrato.ACTIVO });
      await service.cambiarEstado('cnt-001', { estado:EstadoContrato.ACTIVO }, mockUser as any);
      expect(mockRepo.update).toHaveBeenCalledWith('cnt-001', expect.objectContaining({ estado:EstadoContrato.ACTIVO }));
    });

    it('rechaza transición inválida (terminal → ACTIVO)', async () => {
      mockRepo.findById.mockResolvedValue({ ...mockContrato, estado:EstadoContrato.BAJA_DEFINITIVA });
      await expect(service.cambiarEstado('cnt-001', { estado:EstadoContrato.ACTIVO }, mockUser as any)).rejects.toThrow(BadRequestException);
    });

    it('libera IP en BAJA_DEFINITIVA', async () => {
      mockRepo.findById.mockResolvedValueOnce({ ...mockContrato, estado:EstadoContrato.ACTIVO }).mockResolvedValueOnce({ ...mockContrato, estado:EstadoContrato.BAJA_DEFINITIVA });
      await service.cambiarEstado('cnt-001', { estado:EstadoContrato.BAJA_DEFINITIVA, motivo:'Mudanza' }, mockUser as any);
      expect(mockRepo.liberarIp).toHaveBeenCalledWith('cnt-001');
    });
  });

  describe('otorgarProrroga()', () => {
    it('prórroga válida a contrato activo', async () => {
      mockRepo.findById.mockResolvedValueOnce({ ...mockContrato, estado:EstadoContrato.ACTIVO }).mockResolvedValueOnce({ ...mockContrato, estado:EstadoContrato.ACTIVO });
      const futuro = new Date(); futuro.setDate(futuro.getDate()+15);
      await service.otorgarProrroga('cnt-001', { prorrogaHasta:futuro.toISOString().split('T')[0], motivo:'Acuerdo' }, mockUser as any);
      expect(mockRepo.update).toHaveBeenCalledWith('cnt-001', expect.objectContaining({ enProrroga:true }));
    });

    it('rechaza fecha pasada', async () => {
      mockRepo.findById.mockResolvedValue({ ...mockContrato, estado:EstadoContrato.ACTIVO });
      await expect(service.otorgarProrroga('cnt-001', { prorrogaHasta:'2020-01-01', motivo:'test' }, mockUser as any)).rejects.toThrow(BadRequestException);
    });
  });

  describe('activar()', () => {
    it('activa contrato pendiente', async () => {
      mockRepo.findById.mockResolvedValueOnce(mockContrato).mockResolvedValueOnce({ ...mockContrato, estado:EstadoContrato.ACTIVO });
      await service.activar('cnt-001', mockUser as any);
      expect(mockRepo.update).toHaveBeenCalledWith('cnt-001', expect.objectContaining({ estado:EstadoContrato.ACTIVO }));
    });

    it('falla si ya está activo', async () => {
      mockRepo.findById.mockResolvedValue({ ...mockContrato, estado:EstadoContrato.ACTIVO });
      await expect(service.activar('cnt-001', mockUser as any)).rejects.toThrow(BadRequestException);
    });
  });
});
