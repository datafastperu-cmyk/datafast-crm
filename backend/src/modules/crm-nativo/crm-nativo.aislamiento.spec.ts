import { CrmNativoService } from './crm-nativo.service';

// Auditoría 30-31/07/2026. El módulo consultaba chats y mensajes sin filtrar por
// empresa: con un chatId ajeno, cualquier usuario con sesión válida se llevaba la
// conversación completa de otra empresa. Y `upsertChat` era leer → mutar → guardar
// contra una tabla con UNIQUE (empresa_id, wa_chat_id): dos mensajes simultáneos
// del mismo contacto chocaban con un 23505 sin manejar y se perdía uno.
describe('CrmNativoService — aislamiento por empresa y atomicidad', () => {
  const EMPRESA = 'a0000000-0000-0000-0000-000000000001';
  const OTRA    = 'b0000000-0000-0000-0000-000000000002';

  const construir = () => {
    const chatRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      find:    jest.fn().mockResolvedValue([]),
      update:  jest.fn().mockResolvedValue({ affected: 1 }),
      query:   jest.fn().mockResolvedValue([{ id: 'chat-1' }]),
    };
    const mensajeRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      find:    jest.fn().mockResolvedValue([]),
      count:   jest.fn().mockResolvedValue(0),
      query:   jest.fn().mockResolvedValue([{ id: 'msg-1' }]),
      create:  jest.fn(d => d),
      save:    jest.fn(d => Promise.resolve(d)),
    };
    return { svc: new CrmNativoService(chatRepo as any, mensajeRepo as any), chatRepo, mensajeRepo };
  };

  it('upsertChat resuelve el conflicto en la BD y suma los no leídos en SQL', async () => {
    const { svc, chatRepo } = construir();

    await svc.upsertChat(EMPRESA, {
      waChatId: '51999888777@c.us', telefono: '51999888777',
      nombreContacto: 'Cliente', ultimoMensaje: 'hola',
      ultimoMsgAt: new Date(), noLeidos: 1,
    });

    const sql = chatRepo.query.mock.calls[0][0] as string;
    expect(sql).toMatch(/ON CONFLICT \(empresa_id, wa_chat_id\) DO UPDATE/i);
    // El contador se incrementa sobre el valor de la fila, no sobre uno leído antes.
    expect(sql).toMatch(/no_leidos\s*=\s*crm_chats\.no_leidos \+/i);
    // Y no se leyó nada previamente: la operación es una sola sentencia.
    expect(chatRepo.findOne).not.toHaveBeenCalled();
  });

  it('un LID de Meta no se guarda como si fuera un teléfono marcable', async () => {
    const { svc, chatRepo } = construir();

    await svc.upsertChat(EMPRESA, {
      waChatId: '219047677419734@lid', telefono: '219047677419734',
      nombreContacto: null, ultimoMensaje: 'hola', ultimoMsgAt: new Date(), noLeidos: 1,
    });

    const params = chatRepo.query.mock.calls[0][1] as unknown[];
    expect(params[7]).toBe(true);   // es_lid
    expect(params[8]).toBe(false);  // no pisa el teléfono existente

    await svc.upsertChat(EMPRESA, {
      waChatId: '51999888777@c.us', telefono: '51999888777',
      nombreContacto: null, ultimoMensaje: 'hola', ultimoMsgAt: new Date(), noLeidos: 0,
    });
    const params2 = chatRepo.query.mock.calls[1][1] as unknown[];
    expect(params2[7]).toBe(false);
    expect(params2[8]).toBe(true);
  });

  it('la deduplicación se apoya en el índice único, no en un SELECT previo', async () => {
    const { svc, mensajeRepo } = construir();

    await svc.guardarMensaje(EMPRESA, 'chat-1', {
      waMsgId: 'ABC123', direction: 'INBOUND', agente: null, body: 'hola',
    });

    const sql = mensajeRepo.query.mock.calls[0][0] as string;
    expect(sql).toMatch(/ON CONFLICT \(wa_msg_id\)[\s\S]*DO NOTHING/i);
  });

  it('un chatId de otra empresa no devuelve mensajes', async () => {
    const { svc, chatRepo, mensajeRepo } = construir();
    chatRepo.findOne.mockResolvedValue(null); // el chat no es de esta empresa

    const res = await svc.listarMensajes('11111111-1111-1111-1111-111111111111', OTRA);

    expect(res).toEqual([]);
    expect(chatRepo.findOne).toHaveBeenCalledWith({
      where: { id: '11111111-1111-1111-1111-111111111111', empresaId: OTRA },
    });
    expect(mensajeRepo.find).not.toHaveBeenCalled();
  });

  it('devuelve los mensajes MÁS RECIENTES, no los más antiguos', async () => {
    const { svc, chatRepo, mensajeRepo } = construir();
    chatRepo.findOne.mockResolvedValue({ id: 'chat-1', telefono: '51999888777', esLid: false });
    chatRepo.find.mockResolvedValue([{ id: 'chat-1' }]);
    mensajeRepo.find.mockResolvedValue([{ id: 'nuevo' }, { id: 'viejo' }]);

    const res = await svc.listarMensajes('11111111-1111-1111-1111-111111111111', EMPRESA);

    expect(mensajeRepo.find.mock.calls[0][0].order).toEqual({ createdAt: 'DESC' });
    // …y se devuelven en orden cronológico para pintarlos.
    expect(res.map((m: any) => m.id)).toEqual(['viejo', 'nuevo']);
  });

  it('marcar como leído no alcanza a chats de otra empresa', async () => {
    const { svc, chatRepo } = construir();

    await svc.resetNoLeidos('chat-ajeno', EMPRESA);

    expect(chatRepo.update).toHaveBeenCalledWith(
      { id: 'chat-ajeno', empresaId: EMPRESA }, { noLeidos: 0 },
    );
  });

  it('un adjunto de otra empresa no se sirve', async () => {
    const { svc, mensajeRepo } = construir();
    mensajeRepo.count.mockResolvedValue(0);

    expect(await svc.mediaPerteneceAEmpresa('archivo.pdf', OTRA)).toBe(false);
    expect(mensajeRepo.count).toHaveBeenCalledWith({
      where: { mediaUrl: 'archivo.pdf', empresaId: OTRA },
    });
  });
});
