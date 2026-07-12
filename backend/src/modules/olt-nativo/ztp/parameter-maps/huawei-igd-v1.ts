import { ParameterMap } from '../ztp.contracts';

// Mapa TR-098 (InternetGatewayDevice) para ONUs Huawei con este data-model.
// Rutas REALES extraídas de una EG8145V5 V5R020C10S195 vía GenieACS (refreshObject).
// La clave WiFi usa PRIORITY LIST (fallback): el Provision itera hasta que una aplique.
// El placeholder {ppp} = índice de WANConnectionDevice que contiene WANPPPConnection
// (varía por firmware) → se resuelve en runtime vía `discovery`.
export const HUAWEI_IGD_V1: ParameterMap = {
  data_model: 'InternetGatewayDevice',
  map: {
    'wifi.enable':   ['InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.Enable'],
    'wifi.ssid':     ['InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID'],
    'wifi.password': [
      'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.KeyPassphrase',
      'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.KeyPassphrase',
      'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.PreSharedKey',
    ],
    'wifi5g.enable':   ['InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.Enable'],
    'wifi5g.ssid':     ['InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.SSID'],
    'wifi5g.password': [
      'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.KeyPassphrase',
      'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.PreSharedKey.1.KeyPassphrase',
      'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.PreSharedKey.1.PreSharedKey',
    ],
    'internet.username': ['InternetGatewayDevice.WANDevice.1.WANConnectionDevice.{ppp}.WANPPPConnection.1.Username'],
    'internet.password': ['InternetGatewayDevice.WANDevice.1.WANConnectionDevice.{ppp}.WANPPPConnection.1.Password'],
    'voip.user':      ['InternetGatewayDevice.Services.VoiceService.1.VoiceProfile.1.Line.1.SIP.AuthUserName'],
    'voip.password':  ['InternetGatewayDevice.Services.VoiceService.1.VoiceProfile.1.Line.1.SIP.AuthPassword'],
    'voip.number':    ['InternetGatewayDevice.Services.VoiceService.1.VoiceProfile.1.Line.1.DirectoryNumber'],
    'voip.registrar': ['InternetGatewayDevice.Services.VoiceService.1.VoiceProfile.1.SIP.RegistrarServer'],
    'voip.proxy':     ['InternetGatewayDevice.Services.VoiceService.1.VoiceProfile.1.SIP.ProxyServer'],
  },
  discovery: {
    ppp: {
      object: 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice',
      contains: 'WANPPPConnection',
    },
  },
};
