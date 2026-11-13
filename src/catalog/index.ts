/**
 * Registro de perfiles de proveedor. Cada perfil se valida con Zod y con las
 * referencias cruzadas del escenario al cargarse: un catálogo inválido falla
 * pronto (y en los tests), no en mitad de una simulación.
 */
import { ProviderProfile, ScenarioDef, validateScenarioReferences, type CatalogService } from '../model/schemas';
import { genericServices } from './generic';
import { awsServices } from './providers/aws/services';
import { awsReferenceScenario } from '../scenarios/aws-reference';
import { azureServices } from './providers/azure/services';
import { azureReferenceScenario } from '../scenarios/azure-reference';

function buildProfile(input: ProviderProfile): ProviderProfile {
  const profile = ProviderProfile.parse(input);
  for (const s of profile.scenarios) {
    ScenarioDef.parse(s);
    const errors = validateScenarioReferences(s, profile.services);
    if (errors.length) throw new Error(`Scenario ${s.id} inválido:\n${errors.join('\n')}`);
  }
  return profile;
}

export const providers: ProviderProfile[] = [
  buildProfile({
    id: 'aws',
    name: 'Amazon Web Services',
    shortName: 'AWS',
    services: [...genericServices, ...awsServices],
    scenarios: [awsReferenceScenario],
  }),
  buildProfile({
    id: 'azure',
    name: 'Microsoft Azure',
    shortName: 'Azure',
    services: [...genericServices, ...azureServices],
    scenarios: [azureReferenceScenario],
  }),
];

export function catalogFor(providerId: string): CatalogService[] {
  return providers.find((p) => p.id === providerId)?.services ?? [];
}
