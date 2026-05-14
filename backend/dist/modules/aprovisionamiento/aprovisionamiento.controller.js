"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var AprovisionamientoController_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AprovisionamientoController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const aprovisionamiento_service_1 = require("./aprovisionamiento.service");
const aprovisionamiento_dto_1 = require("./aprovisionamiento.dto");
const current_user_decorator_1 = require("../../common/decorators/current-user.decorator");
const roles_decorator_1 = require("../../common/decorators/roles.decorator");
const response_dto_1 = require("../../common/dto/response.dto");
let AprovisionamientoController = AprovisionamientoController_1 = class AprovisionamientoController {
    constructor(svc) {
        this.svc = svc;
        this.logger = new common_1.Logger(AprovisionamientoController_1.name);
    }
    async aprovisionar(dto, user) {
        this.logger.log(`[FTTH] Solicitud de aprovisionamiento: contrato=${dto.contratoId} | por: ${user.email}`);
        const resultado = await this.svc.ejecutar(dto, user);
        const resumen = resultado.exitoso
            ? `✅ Exitoso en ${resultado.duracionTotalMs}ms`
            : `❌ Fallido en paso ${resultado.pasosFallidos?.[0] || '?'} | rollback: ${resultado.rollbackEjecutado}`;
        this.logger.log(`[FTTH] ${resumen} | contrato=${dto.contratoId}`);
        return resultado;
    }
    async rollback(dto, user) {
        this.logger.log(`[ROLLBACK] Contrato: ${dto.contratoId} | motivo: ${dto.motivo} | por: ${user.email}`);
        const resultado = await this.svc.ejecutarRollback(dto, undefined, user);
        return response_dto_1.ApiResponse.ok(resultado, `Rollback completado: ${resultado.revertidos.length} acciones | ${resultado.errores.length} errores`);
    }
    async renotificar(contratoId, user) {
        const [row] = await this.svc['ds']?.query?.(`
      SELECT cl.nombre_completo, cl.telefono, cl.whatsapp,
             pl.nombre AS plan_nombre, pl.velocidad_bajada, pl.velocidad_subida,
             co.usuario_pppoe
      FROM contratos co
      JOIN clientes cl ON cl.id = co.cliente_id
      JOIN planes   pl ON pl.id = co.plan_id
      WHERE co.id = $1 AND co.empresa_id = $2
    `, [contratoId, user.empresaId]) || [];
        if (!row) {
            return response_dto_1.ApiResponse.ok({ enviado: false }, 'Contrato no encontrado');
        }
        const whatsapp = this.svc['whatsapp'];
        const r = await whatsapp.notificarBienvenida({
            telefono: row.whatsapp || row.telefono,
            clienteNombre: row.nombre_completo,
            planNombre: row.plan_nombre,
            velocidadBajada: row.velocidad_bajada,
            velocidadSubida: row.velocidad_subida,
            usuarioPppoe: row.usuario_pppoe,
            empresaId: user.empresaId,
        });
        return response_dto_1.ApiResponse.ok(r, r.enviado ? 'WhatsApp enviado' : `No enviado: ${r.error}`);
    }
};
exports.AprovisionamientoController = AprovisionamientoController;
__decorate([
    (0, common_1.Post)('ftth'),
    (0, roles_decorator_1.RequirePermission)('onu:provision'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, swagger_1.ApiOperation)({
        summary: '🚀 Aprovisionar cliente FTTH — 8 pasos automáticos',
        description: `
Ejecuta secuencialmente los 8 pasos del flujo de aprovisionamiento FTTH:

**PASO 1** — Valida el contrato, cliente, plan, router y OLT. Carga el contexto completo.

**PASO 2** — Asigna la próxima IP disponible del pool IPv4, o usa \`ipManual\`. Si el contrato ya tiene IP, la reutiliza.

**PASO 3** — Crea el usuario PPPoE en el router Mikrotik con IP remota fija apuntando a la IP asignada.

**PASO 4** — Configura el control de velocidad: Simple Queue, Queue Tree individual o PCQ global según el plan.

**PASO 5** — Verifica/crea las reglas de firewall para el sistema de suspensión por mora (Address Lists morosos/prórroga).

**PASO 6** — Detecta la ONU en SmartOLT (automáticamente en el puerto PON, o por SN si se provee) y la aprovisiona con el perfil y VLAN del plan.

**PASO 7** — Registra la ONU en la base de datos local y la asocia al contrato.

**PASO 8** — Activa el contrato (estado → ACTIVO), envía WhatsApp de bienvenida al cliente y emite evento WebSocket.

Si algún paso falla y \`rollbackEnError=true\`, se revierte automáticamente: elimina el PPPoE, elimina la provisión en SmartOLT y libera la IP al pool.
    `,
    }),
    (0, swagger_1.ApiResponse)({
        status: 200,
        type: aprovisionamiento_dto_1.AprovisionamientoResultadoDto,
        description: 'Resultado detallado de los 8 pasos',
    }),
    (0, swagger_1.ApiResponse)({ status: 400, description: 'Validación fallida en algún paso' }),
    (0, swagger_1.ApiResponse)({ status: 404, description: 'Contrato, router u OLT no encontrado' }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [aprovisionamiento_dto_1.AprovisionarFtthDto, Object]),
    __metadata("design:returntype", Promise)
], AprovisionamientoController.prototype, "aprovisionar", null);
__decorate([
    (0, common_1.Post)('rollback'),
    (0, roles_decorator_1.Roles)('Administrador', 'Supervisor'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, swagger_1.ApiOperation)({
        summary: '↩️ Rollback de aprovisionamiento',
        description: `
Revierte un aprovisionamiento realizado (total o parcialmente):

1. Elimina la provisión de SmartOLT (si existe)
2. Elimina el usuario PPPoE del Mikrotik
3. Libera la IP al pool (ips_asignadas.activa = false)
4. Desasocia la ONU del contrato en BD
5. Revierte el estado del contrato a \`pendiente_instalacion\`

Útil cuando hay un error de instalación física o se necesita mover al cliente a otro nodo.
    `,
    }),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [aprovisionamiento_dto_1.RollbackAprovisionamientoDto, Object]),
    __metadata("design:returntype", Promise)
], AprovisionamientoController.prototype, "rollback", null);
__decorate([
    (0, common_1.Post)('notificar/:contratoId'),
    (0, roles_decorator_1.RequirePermission)('contratos:view'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, swagger_1.ApiOperation)({
        summary: 'Reenviar notificación WhatsApp al cliente',
        description: 'Reenvía el mensaje de bienvenida al cliente del contrato indicado.',
    }),
    (0, swagger_1.ApiParam)({ name: 'contratoId', description: 'UUID del contrato' }),
    __param(0, (0, common_1.Param)('contratoId', common_1.ParseUUIDPipe)),
    __param(1, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], AprovisionamientoController.prototype, "renotificar", null);
exports.AprovisionamientoController = AprovisionamientoController = AprovisionamientoController_1 = __decorate([
    (0, swagger_1.ApiTags)('Aprovisionamiento FTTH'),
    (0, swagger_1.ApiBearerAuth)('JWT'),
    (0, common_1.Controller)('aprovisionamiento'),
    __metadata("design:paramtypes", [aprovisionamiento_service_1.OrquestadorAprovisionamientoService])
], AprovisionamientoController);
//# sourceMappingURL=aprovisionamiento.controller.js.map