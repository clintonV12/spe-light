/**
 * api/endpoints.ts — public barrel re-export.
 *
 * Every page and hook imports from here:
 *   import { plansApi, activitiesApi } from '../api/endpoints'
 *
 * The actual implementation (mock vs real switching) lives in endpointsImpl.ts.
 * Adding a new API surface: export it from endpointsImpl.ts and re-export here.
 */
export {
  authApi,
  invitationsApi,
  plansApi,
  activitiesApi,
  pillarsApi,
  milestonesApi,
  reportsApi,
  aiApi,
  orgApi,
  ssoApi,
  adminApi,
  auditApi,
} from './endpointsImpl'