// __tests__/api/opds-series-list.test.ts
//
// The OPDS series list (a navigation feed listing series). #218: each series entry carries its
// creators as <author>, its publisher in <dc:publisher>, and a real <updated>; the response declares
// kind=navigation, and the link to each series' own feed — which is an acquisition feed — says so.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/opds/series/route';

const mocks = vi.hoisted(() => ({
    validateApiKey: vi.fn(),
    seriesFindMany: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({ validateApiKey: mocks.validateApiKey }));
vi.mock('@/lib/db', () => ({ prisma: { series: { findMany: mocks.seriesFindMany } } }));
vi.mock('@/lib/library-access', () => ({
    getAccessibleLibraryIds: vi.fn(async () => 'ALL'),
    seriesAccessWhere: vi.fn(() => ({})),
}));

const request = () => GET(new Request('http://localhost/api/opds/series'));

const EARLIER = new Date('2026-09-01T00:00:00.000Z');
const LATER = new Date('2026-09-25T08:30:00.000Z');

describe('API Route: OPDS Series List (/api/opds/series)', () => {
    beforeEach(() => {
        mocks.validateApiKey.mockResolvedValue({ valid: true, user: { id: 'u1', role: 'USER' }, keyType: 'OPDS_KEY' });
    });

    it('is a navigation feed and links each series to its acquisition feed', async () => {
        mocks.seriesFindMany.mockResolvedValue([
            { id: 'ser_1', name: 'Batman', publisher: 'DC Comics', description: null, folderPath: '/comics/Batman', coverUrl: null, updatedAt: LATER },
        ]);

        const res = await request();

        expect(res.headers.get('Content-Type'))
            .toBe('application/atom+xml;profile=opds-catalog;kind=navigation; charset=utf-8');
        const xml = await res.text();
        expect(xml).toMatch(/<link rel="subsection" href="[^"]*\/api\/opds\/series\/ser_1" type="application\/atom\+xml;profile=opds-catalog;kind=acquisition"\/>/);
    });

    it('publishes the creators as authors, the publisher as dc:publisher and a real updated', async () => {
        mocks.seriesFindMany.mockResolvedValue([
            {
                id: 'ser_1', name: 'Batman', publisher: 'DC Comics', description: null,
                folderPath: '/comics/Batman', coverUrl: null, updatedAt: LATER,
                writers: '["Tom King"]', artists: '["Mikel Janín", "David Finch"]',
            },
        ]);

        const xml = await (await request()).text();

        expect(xml).toContain('<author><name>Tom King</name></author>');
        expect(xml).toContain('<author><name>Mikel Janín</name></author>');
        expect(xml).toContain('<author><name>David Finch</name></author>');
        expect(xml).toContain('<dc:publisher>DC Comics</dc:publisher>');
        expect(xml).not.toContain('<author><name>DC Comics</name></author>');
        expect(xml).toContain(`<updated>${LATER.toISOString()}</updated>`);
    });

    it('sets the feed <updated> to the newest entry, and falls back to a stable stamp when empty', async () => {
        mocks.seriesFindMany.mockResolvedValue([
            { id: 'ser_1', name: 'Batman', publisher: null, description: null, folderPath: '/comics/Batman', coverUrl: null, updatedAt: EARLIER },
            { id: 'ser_2', name: 'Saga', publisher: null, description: null, folderPath: '/comics/Saga', coverUrl: null, updatedAt: LATER },
        ]);

        const xml = await (await request()).text();
        const feedHead = xml.slice(xml.indexOf('<feed'), xml.indexOf('<entry'));
        expect(feedHead).toContain(`<updated>${LATER.toISOString()}</updated>`);

        mocks.seriesFindMany.mockResolvedValue([]);
        const empty = await (await request()).text();
        expect(empty).toContain('<updated>1970-01-01T00:00:00.000Z</updated>');
    });

    it('emits no <author> for a series without creators, but keeps the feed valid with its own', async () => {
        mocks.seriesFindMany.mockResolvedValue([
            { id: 'ser_1', name: 'Unknown', publisher: null, description: null, folderPath: '/comics/Unknown', coverUrl: null, updatedAt: LATER },
        ]);

        const xml = await (await request()).text();

        const entry = xml.slice(xml.indexOf('<entry>'), xml.indexOf('</entry>'));
        expect(entry).not.toContain('<author>');
        expect(xml).toContain('<author><name>Omnibus</name></author>');
    });
});
