import type { DataClient } from '../types';
import { LocalPeopleClient } from './people';
import { LocalRelationshipClient } from './relationship';
import { LocalPlacesClient } from './places';
import { LocalFamiliesClient } from './families';
import { LocalEventsClient } from './events';
import { LocalTreeClient } from './tree';
import { LocalTreesClient } from './trees';
import { LocalMediaClient } from './media';
import { LocalSourcesClient } from './sources';
import { LocalCitationsClient } from './citations';
import { LocalRepositoriesClient } from './repositories';
import { LocalNotesClient } from './notes';
import { LocalAuditClient } from './audit';
import { LocalDashboardClient } from './dashboard';
import { LocalDataChecksClient } from './data-checks';
import { LocalGedcomClient } from './gedcom';
import { LocalCasesClient } from './cases';

/** DataClient backed by in-browser PGlite. */
export class LocalDataClient implements DataClient {
  people = new LocalPeopleClient();
  relationship = new LocalRelationshipClient();
  places = new LocalPlacesClient();
  families = new LocalFamiliesClient();
  events = new LocalEventsClient();
  tree = new LocalTreeClient();
  trees = new LocalTreesClient();
  media = new LocalMediaClient();
  sources = new LocalSourcesClient();
  citations = new LocalCitationsClient();
  repositories = new LocalRepositoriesClient();
  notes = new LocalNotesClient();
  audit = new LocalAuditClient();
  dashboard = new LocalDashboardClient();
  dataChecks = new LocalDataChecksClient();
  gedcom = new LocalGedcomClient();
  cases = new LocalCasesClient();
}
