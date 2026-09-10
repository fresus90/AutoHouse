import type { ProviderSlug } from '../core/types.js';
import { DemoDriver } from './drivers/demo.driver.js';
import { DmDriver } from './drivers/dm.driver.js';
import { ReweDriver } from './drivers/rewe.driver.js';
import type { ShopDriver } from './types.js';

const drivers: Record<ProviderSlug, ShopDriver> = {
  rewe: new ReweDriver(),
  dm: new DmDriver(),
  demo: new DemoDriver(),
};

export function getDriver(provider: ProviderSlug): ShopDriver {
  const driver = drivers[provider];
  if (!driver) throw new Error(`Unbekannter Shop-Typ: ${provider}`);
  return driver;
}

export function listProviders(): Array<{
  provider: ProviderSlug;
  label: string;
  supportsDeliverySlots: boolean;
  requiresBrowser: boolean;
}> {
  return (Object.keys(drivers) as ProviderSlug[]).map((provider) => {
    const driver = drivers[provider];
    return {
      provider,
      label: driver.label,
      supportsDeliverySlots: driver.supportsDeliverySlots,
      requiresBrowser: driver.requiresBrowser,
    };
  });
}
