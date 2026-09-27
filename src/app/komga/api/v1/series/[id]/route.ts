// src/app/komga/api/v1/series/[id]/route.ts — #206 Komga facade: one series (Paperback's
// "manga details": title, status, summary, genres/tags, writers + pencillers, reading direction).
import { authenticateKomga, komgaGuard, komgaJson, komgaError } from '@/lib/komga/auth';
import { findAccessibleSeries, seriesDetail } from '@/lib/komga/data';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
    return komgaGuard('series/{id}', async () => {
        const auth = await authenticateKomga(req);
        if (!auth.ok) return auth.response;
        const { id } = await params;
        const found = await findAccessibleSeries(id, auth.libs);
        if (!found.ok) return komgaError(found.status);
        return komgaJson(await seriesDetail(found.series, auth.user.id));
    });
}

// Newer Komga clients POST /series/list (a search), which lands on this [id] segment; Next's own
// 405 has an empty body the client can't parse. Answer it the Komga way instead (#206 round 4).
export async function POST(req: Request) {
    return komgaError(405, new URL(req.url).pathname.replace(/^\/komga/, ''));
}
