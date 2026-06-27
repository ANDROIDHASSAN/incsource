import { apifyLinkedinProvider } from './apifyLinkedinProvider.js';
import { harvestLinkedinProvider } from './harvestLinkedinProvider.js';
import { indeedResumeProvider } from './indeedResumeProvider.js';
import { naukriJobsProvider } from './naukriJobsProvider.js';
import { inboundProvider } from './inboundProvider.js';

// Register every source here. Adding a provider = drop a file + one line below.
export const providers = {
  [inboundProvider.id]: inboundProvider,
  [harvestLinkedinProvider.id]: harvestLinkedinProvider,
  [apifyLinkedinProvider.id]: apifyLinkedinProvider,
  [indeedResumeProvider.id]: indeedResumeProvider,
  [naukriJobsProvider.id]: naukriJobsProvider,
};

export function listProviders() {
  return Object.values(providers).map((p) => ({
    id: p.id,
    label: p.label,
    compliance: p.compliance,
    live: p.live(),
  }));
}
