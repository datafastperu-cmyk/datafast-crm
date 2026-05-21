import { Module }       from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule }    from '@nestjs/bull';
import { HttpModule }    from '@nestjs/axios';
import { EventEmitterModule } from '@nestjs/event-emitter';

import { GoogleAccount }  from './entities/google-account.entity';
import { GoogleSyncLog }  from './entities/google-sync-log.entity';

import { GoogleOAuthService }     from './services/google-oauth.service';
import { GoogleCalendarService }  from './services/google-calendar.service';
import { GoogleContactsService }  from './services/google-contacts.service';
import { GoogleDriveService }     from './services/google-drive.service';
import { GoogleMapsService }      from './services/google-maps.service';

import { GoogleSyncProcessor }    from './processors/google-sync.processor';
import { GoogleEventsListener }   from './listeners/google-events.listener';
import { GoogleIntegrationController } from './google-integration.controller';

import { QUEUES } from '../workers/workers.constants';

@Module({
  imports: [
    TypeOrmModule.forFeature([GoogleAccount, GoogleSyncLog]),

    BullModule.registerQueue({
      name: QUEUES.GOOGLE_SYNC,
      defaultJobOptions: {
        attempts:         3,
        backoff:          { type: 'exponential', delay: 15_000 },
        removeOnComplete: 200,
        removeOnFail:     500,
      },
    }),

    HttpModule.register({
      timeout:    10_000,
      maxRedirects: 3,
    }),

    EventEmitterModule,
  ],
  controllers: [GoogleIntegrationController],
  providers: [
    GoogleOAuthService,
    GoogleCalendarService,
    GoogleContactsService,
    GoogleDriveService,
    GoogleMapsService,
    GoogleSyncProcessor,
    GoogleEventsListener,
  ],
  exports: [
    GoogleOAuthService,
    GoogleCalendarService,
    GoogleContactsService,
    GoogleDriveService,
    GoogleMapsService,
  ],
})
export class GoogleIntegrationModule {}
