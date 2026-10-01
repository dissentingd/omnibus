// src/app/api/opds/series/[id]/route.ts
import { prisma } from '@/lib/db';
import { validateApiKey } from '@/lib/api-auth';
import { getErrorMessage } from '@/lib/utils/error';
import { Logger } from '@/lib/logger';
import { escapeXml } from '@/lib/utils/xml';
import { getAccessibleLibraryIds, canAccessLibraryId } from '@/lib/library-access';
import { countArchivePages, isPageCountable, countArchivePagesViaEngine, isEngineCountable } from '@/lib/utils/archive-pages';
import { getPublicBaseUrl } from '@/lib/opds-base-url';
import { opdsCoverLinks } from '@/lib/opds-covers';
import { authorElements, entryUpdated, feedContentType, feedUpdated, issueCreators, issueEntryTitle, publisherElement } from '@/lib/opds-feed';
import { mediaTypeForFile } from '@/lib/file-download';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const auth = await validateApiKey(req);
        if (!auth.valid || !auth.user) {
            return new Response('Unauthorized', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="Omnibus OPDS"' } });
        }

    const url = new URL(req.url);
    const baseUrl = getPublicBaseUrl(req);
    
    const resolvedParams = await params;
    const seriesId = resolvedParams.id;

    const series = await prisma.series.findUnique({
        where: { id: seriesId },
        include: {
            issues: {
                where: { filePath: { not: null } }
            }
        }
    });

    if (!series) return new Response('Not Found', { status: 404 });

    // Per-library access: non-admins only see series in libraries they've been granted.
    const accessibleLibs = await getAccessibleLibraryIds(auth.user?.id, auth.user?.role);
    if (!canAccessLibraryId(accessibleLibs, series.libraryId)) {
        return new Response('Forbidden', { status: 403 });
    }

    const sortedIssues = series.issues.sort((a, b) => {
        // #203: annuals shelve AFTER the main run (same order as the series page), then by number.
        const domain = ((a as any).isAnnual ? 1 : 0) - ((b as any).isAnnual ? 1 : 0);
        if (domain !== 0) return domain;
        // Added the '-' character to the regex to preserve negative numbers
        const numA = parseFloat(a.number.replace(/[^0-9.-]/g, '')) || 0;
        const numB = parseFloat(b.number.replace(/[^0-9.-]/g, '')) || 0;
        return numA - numB;
    });

    const entries = [];
    for (const issue of sortedIssues) {
        // --- MEMORY LEAK FIXED: Pulling directly from DB instead of loading files into RAM ---
        let pageCount = (issue as any).pageCount || 0;
        // Self-heal issues indexed before page counts were persisted: without a real pse:count,
        // OPDS clients (Panels) show "0 pages" and refuse to stream. Zips are counted locally
        // (central directory only — fast); RAR-family goes through the engine's unrar listing
        // (native CBR reading), so unconverted .cbr issues stream too. The result is written back
        // so this runs once per issue.
        if (!pageCount && isPageCountable(issue.filePath)) {
            pageCount = await countArchivePages(issue.filePath);
        } else if (!pageCount && isEngineCountable(issue.filePath)) {
            pageCount = await countArchivePagesViaEngine(issue.filePath);
        }
        if (!((issue as any).pageCount || 0) && pageCount > 0) {
            await prisma.issue.update({ where: { id: issue.id }, data: { pageCount } }).catch(() => {});
        }

        // The Official OPDS-PSE Streaming Link with the URI Template. The page route serves WebP from
        // the engine (1600px) and only falls back to the stored bytes when the engine is down, so the
        // declared type follows the response that is actually served (#218).
        const pseLink = `<link rel="http://vaemendis.net/opds-pse/stream" type="image/webp" href="${baseUrl}/api/opds/page/${issue.id}/{pageNumber}" pse:count="${pageCount}"/>`;

        // Every publication entry carries its acquisition link, whatever the caller's permissions
        // (#221 point 4): §5.4 asks for one on every entry, the download route already answers 403 to
        // a user without download rights, and dropping the entry would also drop the page-stream for
        // a user who can only stream. The declared type is the file's real media type, so it matches
        // the response it points at (§5.3).
        const downloadLink = issue.filePath
            ? `<link rel="http://opds-spec.org/acquisition" href="${baseUrl}/api/opds/download?issueId=${issue.id}" type="${mediaTypeForFile(issue.filePath)}"/>`
            : '';

        entries.push(`
  <entry>
    <title>${escapeXml(issueEntryTitle(series.name, issue))}</title>
    <id>urn:omnibus:issue:${issue.id}</id>
    <updated>${entryUpdated(issue.updatedAt)}</updated>
    ${authorElements(issueCreators(issue, series))}
    ${publisherElement(series.publisher)}
    <content type="text">${escapeXml(issue.description || 'No synopsis available.')}</content>
    ${opdsCoverLinks(baseUrl, 'issue', issue.id)}
    ${pseLink}
    ${downloadLink}
  </entry>`);
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opds="http://opds-spec.org/2010/catalog" xmlns:pse="http://vaemendis.net/opds-pse/ns" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <id>urn:omnibus:series:${series.id}</id>
  <title>${escapeXml(series.name)}</title>
  <updated>${feedUpdated(sortedIssues.map(i => i.updatedAt))}</updated>
  <author><name>Omnibus</name></author>
  <link rel="self" href="${baseUrl}/api/opds/series/${series.id}" type="application/atom+xml;profile=opds-catalog;kind=acquisition"/>
  <link rel="start" href="${baseUrl}/api/opds" type="application/atom+xml;profile=opds-catalog;kind=navigation"/>
  <link rel="up" href="${baseUrl}/api/opds/series" type="application/atom+xml;profile=opds-catalog;kind=navigation"/>
  ${entries.join('')}
</feed>`;

    return new Response(xml, { headers: { 'Content-Type': feedContentType('acquisition') } });
    } catch (error: unknown) {
        Logger.log(`[OPDS Series Detail API] Error: ${getErrorMessage(error)}`, 'error');
        return new Response('Internal Server Error', { status: 500 });
    }
}