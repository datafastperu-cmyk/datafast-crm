import { IsString, IsOptional, IsBoolean, IsEnum } from 'class-validator';

export class GoogleOAuthCallbackDto {
  @IsString() code: string;
  @IsString() state: string;
  @IsOptional() @IsString() error?: string;
}

export class UpdateGoogleServicesDto {
  @IsOptional() @IsBoolean() calendarEnabled?: boolean;
  @IsOptional() @IsBoolean() contactsEnabled?: boolean;
  @IsOptional() @IsBoolean() driveEnabled?: boolean;
  @IsOptional() @IsBoolean() mapsEnabled?: boolean;
}

export class GeocodeDto {
  @IsString() address: string;
}

export class GoogleCalendarEventDto {
  @IsString() summary: string;
  @IsOptional() @IsString() description?: string;
  @IsString() startDateTime: string;
  @IsString() endDateTime: string;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsString() clienteId?: string;
  @IsOptional() @IsString() referenceId?: string;
  @IsOptional() @IsString() colorId?: string;
}

export class SyncContactDto {
  @IsString() clienteId: string;
}

export class DriveUploadDto {
  @IsString() backupId: string;
}
