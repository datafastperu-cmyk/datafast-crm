import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';

import { PeMufa } from './entities/pe-mufa.entity';
import { PeNap } from './entities/pe-nap.entity';
import { PeNapPuerto } from './entities/pe-nap-puerto.entity';
import { PeAcometida } from './entities/pe-acometida.entity';
import { PeFibraSegmento } from './entities/pe-fibra-segmento.entity';
import { PeFibraHilo } from './entities/pe-fibra-hilo.entity';
import { PeSplitter } from './entities/pe-splitter.entity';
import { PeSplitterSalida } from './entities/pe-splitter-salida.entity';

import { PlantaExternaService } from './planta-externa.service';
import { PlantaExternaPuertosService } from './planta-externa-puertos.service';
import { PlantaExternaBarridoCron } from './planta-externa-barrido.cron';
import { PlantaExternaController } from './planta-externa.controller';

/**
 * Módulo de planta externa FTTH.
 *
 * NO implementa el patrón degradado, y es deliberado: pertenece al Core Indestructible.
 * Su única dependencia es la base de datos principal — no habla con hardware, ni con APIs
 * de terceros, ni con nada opcional. Si su init falla, lo correcto es que el backend
 * crashee, no que arranque a medias fingiendo que la planta está documentada.
 *
 * La única pieza degradable del flujo es la geocodificación (`GoogleMapsService`), que
 * vive en `google-integration` y ya se endurece allí: una coordenada manual siempre debe
 * poder guardarse aunque Google esté caído o sin cuota.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      PeMufa, PeNap, PeNapPuerto, PeAcometida,
      PeFibraSegmento, PeFibraHilo, PeSplitter, PeSplitterSalida,
    ]),
    AuthModule, // AuditoriaService
  ],
  controllers: [PlantaExternaController],
  providers: [
    PlantaExternaService,
    PlantaExternaPuertosService,
    PlantaExternaBarridoCron,
  ],
  exports: [PlantaExternaService, PlantaExternaPuertosService],
})
export class PlantaExternaModule {}
