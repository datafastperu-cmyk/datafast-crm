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
    // Orden validado en vivo (EG8145V5 V5R020C10S195): KeyPassphrase directo da
    // cwmp.9003 "Invalid arguments"; PreSharedKey.1.KeyPassphrase aplica OK → va primero.
    'wifi.password': [
      'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.KeyPassphrase',
      'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.PreSharedKey',
      'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.KeyPassphrase',
    ],
    'wifi5g.enable':   ['InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.Enable'],
    'wifi5g.ssid':     ['InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.SSID'],
    'wifi5g.password': [
      'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.PreSharedKey.1.KeyPassphrase',
      'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.PreSharedKey.1.PreSharedKey',
      'InternetGatewayDevice.LANDevice.1.WLANConfiguration.5.KeyPassphrase',
    ],
    'internet.username': ['InternetGatewayDevice.WANDevice.1.WANConnectionDevice.{ppp}.WANPPPConnection.1.Username'],
    'internet.password': ['InternetGatewayDevice.WANDevice.1.WANConnectionDevice.{ppp}.WANPPPConnection.1.Password'],
    'voip.user':      ['InternetGatewayDevice.Services.VoiceService.1.VoiceProfile.1.Line.1.SIP.AuthUserName'],
    'voip.password':  ['InternetGatewayDevice.Services.VoiceService.1.VoiceProfile.1.Line.1.SIP.AuthPassword'],
    'voip.number':    ['InternetGatewayDevice.Services.VoiceService.1.VoiceProfile.1.Line.1.DirectoryNumber'],
    'voip.registrar': ['InternetGatewayDevice.Services.VoiceService.1.VoiceProfile.1.SIP.RegistrarServer'],
    'voip.proxy':     ['InternetGatewayDevice.Services.VoiceService.1.VoiceProfile.1.SIP.ProxyServer'],
    // Credenciales CWMP (auth ONU→ACS). Parámetros estándar TR-098; Password es write-only por spec.
    'management.username': ['InternetGatewayDevice.ManagementServer.Username'],
    'management.password': ['InternetGatewayDevice.ManagementServer.Password'],
    // ConnectionRequest (auth ACS→ONU) — único por ONU. Estándar TR-098; Password write-only.
    'management.connreq_user': ['InternetGatewayDevice.ManagementServer.ConnectionRequestUsername'],
    'management.connreq_pass': ['InternetGatewayDevice.ManagementServer.ConnectionRequestPassword'],
    // Credenciales de acceso de la ONU. Rutas verificadas writable en vivo (EG8145V5 V5R020C10S195,
    // 2026-07-12). X_HW_WebUserInfo.2 = admin web (Epadmin/telecomadmin); .1 = usuario web;
    // X_HW_CLIUserInfo.1 = root CLI/Telnet (Eproot; el campo de clave es 'Userpassword').
    'onu_admin.user':     ['InternetGatewayDevice.UserInterface.X_HW_WebUserInfo.2.UserName'],
    'onu_admin.password': ['InternetGatewayDevice.UserInterface.X_HW_WebUserInfo.2.Password'],
    'onu_webuser.user':     ['InternetGatewayDevice.UserInterface.X_HW_WebUserInfo.1.UserName'],
    'onu_webuser.password': ['InternetGatewayDevice.UserInterface.X_HW_WebUserInfo.1.Password'],
    'onu_cli.user':     ['InternetGatewayDevice.UserInterface.X_HW_CLIUserInfo.1.Username'],
    'onu_cli.password': ['InternetGatewayDevice.UserInterface.X_HW_CLIUserInfo.1.Userpassword'],
  },
  discovery: {
    ppp: {
      object: 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice',
      contains: 'WANPPPConnection',
    },
  },
};
