"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CurrentEmpresaId = exports.CurrentUserId = exports.CurrentUser = void 0;
const common_1 = require("@nestjs/common");
exports.CurrentUser = (0, common_1.createParamDecorator)((field, ctx) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;
    if (!user)
        return null;
    return field ? user[field] : user;
});
exports.CurrentUserId = (0, common_1.createParamDecorator)((_, ctx) => ctx.switchToHttp().getRequest().user?.sub);
exports.CurrentEmpresaId = (0, common_1.createParamDecorator)((_, ctx) => ctx.switchToHttp().getRequest().user?.empresaId);
//# sourceMappingURL=current-user.decorator.js.map