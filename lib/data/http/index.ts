import type { DataClient } from '../types';
import { HttpPeopleClient } from './people';
import { HttpRelationshipClient } from './relationship';
import { HttpPlacesClient } from './places';
import { HttpFamiliesClient } from './families';
import { HttpEventsClient } from './events';
import { HttpTreeClient } from './tree';
import { HttpTreesClient } from './trees';
import { HttpMediaClient } from './media';
import { HttpSourcesClient } from './sources';
import { HttpCitationsClient } from './citations';
import { HttpRepositoriesClient } from './repositories';
import { HttpNotesClient } from './notes';
import { HttpAuditClient } from './audit';
import { HttpDashboardClient } from './dashboard';
import { HttpDataChecksClient } from './data-checks';
import { HttpGedcomClient } from './gedcom';
import { HttpCasesClient } from './cases';

/** DataClient backed by the hosted REST API (`/api/*`). */
export class HttpDataClient implements DataClient {
  people = new HttpPeopleClient();
  relationship = new HttpRelationshipClient();
  places = new HttpPlacesClient();
  families = new HttpFamiliesClient();
  events = new HttpEventsClient();
  tree = new HttpTreeClient();
  trees = new HttpTreesClient();
  media = new HttpMediaClient();
  sources = new HttpSourcesClient();
  citations = new HttpCitationsClient();
  repositories = new HttpRepositoriesClient();
  notes = new HttpNotesClient();
  audit = new HttpAuditClient();
  dashboard = new HttpDashboardClient();
  dataChecks = new HttpDataChecksClient();
  gedcom = new HttpGedcomClient();
  cases = new HttpCasesClient();
}
