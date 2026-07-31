jest.mock('whatsapp-web.js', () => ({ Client: class {}, LocalAuth: class {}, MessageMedia: {} }));
jest.mock('qrcode', () => ({ toDataURL: jest.fn() }));

import { WaClientService } from './wa-client.service';

// Primera vinculación real (31/07/2026): de 21 chats creados, 10 eran listas de
// difusión. El filtro descartaba grupos y `status@broadcast`, pero una lista de
// difusión es `<numero>@broadcast` y pasaba de largo: "CLIENTES MOROSOS CORTE" y
// "15 de cada mes" quedaron en crm_chats como si fueran clientes, con el id de la
// lista escrito en la columna `telefono`.
describe('WaClientService — qué entra al CRM (incidente listas de difusión 31/07)', () => {
  const esIndividual = (msg: any) => (WaClientService as any).esConversacionIndividual(msg);

  it('acepta conversaciones uno a uno', () => {
    expect(esIndividual({ from: '51999888777@c.us', to: '51900000000@c.us' })).toBe(true);
    expect(esIndividual({ from: '219047677419734@lid', to: '51900000000@c.us' })).toBe(true);
  });

  it('descarta listas de difusión, grupos, estados y canales', () => {
    expect(esIndividual({ from: '1672929049@broadcast' })).toBe(false); // la que se coló
    expect(esIndividual({ from: 'status@broadcast' })).toBe(false);
    expect(esIndividual({ from: '120363000000000000@g.us' })).toBe(false);
    expect(esIndividual({ from: '123@newsletter' })).toBe(false);
    expect(esIndividual({ from: '51999888777@c.us', isGroup: true })).toBe(false);
  });

  it('mira remitente y destinatario: enviar a una lista tampoco crea chat', () => {
    expect(esIndividual({ from: '51900000000@c.us', to: '1599635828@broadcast' })).toBe(false);
  });
});
