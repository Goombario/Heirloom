/**
 * Every record site, in the order the search tab lists them. Adding a site is
 * a site file, one line here and its message strings (docs/research-sites.md).
 */

import type { SiteDefinition } from '@/lib/research/site';
import automatedgenealogy from './automatedgenealogy';
import canadiana from './canadiana';
import chroniclingamerica from './chroniclingamerica';
import cvwm from './cvwm';
import familysearch from './familysearch';
import findagrave from './findagrave';
import freebmd from './freebmd';
import freecen from './freecen';
import internetarchive from './internetarchive';
import irishgenealogy from './irishgenealogy';
import lac from './lac';
import novascotia from './novascotia';
import openarchives from './openarchives';
import paperspast from './paperspast';
import trove from './trove';

export const SITES: readonly SiteDefinition[] = [
    familysearch,
    findagrave,
    chroniclingamerica,
    trove,
    freebmd,
    freecen,
    internetarchive,
    // Canada
    lac,
    canadiana,
    cvwm,
    novascotia,
    automatedgenealogy,
    // Netherlands and Belgium
    openarchives,
    // Ireland
    irishgenealogy,
    // New Zealand
    paperspast,
];
