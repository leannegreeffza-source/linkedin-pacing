import { getToken } from 'next-auth/jwt';
import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

// Simple file-based storage — replace with your DB (e.g. Prisma, Supabase, MongoDB) as needed
const DATA_DIR = path.join(process.cwd(), '.data');

async function getUserFilePath(userId) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  return path.join(DATA_DIR, `exclusions_${userId}.json`);
}

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    if (!token?.sub) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const filePath = await getUserFilePath(token.sub);
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      return NextResponse.json(JSON.parse(raw));
    } catch {
      // No exclusions saved yet
      return NextResponse.json({ excludedAccountIds: [] });
    }
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    if (!token?.sub) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const body = await request.json();
    const filePath = await getUserFilePath(token.sub);
    await fs.writeFile(filePath, JSON.stringify(body, null, 2), 'utf-8');
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}