import { Module } from '@nestjs/common';
import { StripeConnectProvider } from '@fraterunion-payments/provider-stripe';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { AppConfigService } from '../config/app-config.service';
import { DatabaseModule } from '../database/database.module';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { DisabledStripeConnectProvider } from './disabled-stripe-connect.provider';
import { ProviderConnectionsController } from './provider-connections.controller';
import { ProviderAccountConnectionService } from './provider-connections.service';
import { STRIPE_CONNECT_PROVIDER } from './stripe-connect.tokens';

@Module({
  imports: [DatabaseModule, AuditModule, AuthModule, IdempotencyModule],
  controllers: [ProviderConnectionsController],
  providers: [
    {
      provide: STRIPE_CONNECT_PROVIDER,
      inject: [AppConfigService],
      useFactory: (
        config: AppConfigService,
      ): StripeConnectProvider | DisabledStripeConnectProvider => {
        if (!config.stripeEnabled || config.stripeSecretKey === undefined) {
          return new DisabledStripeConnectProvider();
        }
        return new StripeConnectProvider({
          secretKey: config.stripeSecretKey,
          allowLive: config.nodeEnv === 'production',
          urlEnvironment: config.nodeEnv,
        });
      },
    },
    ProviderAccountConnectionService,
  ],
  exports: [ProviderAccountConnectionService],
})
export class ProviderConnectionsModule {}
