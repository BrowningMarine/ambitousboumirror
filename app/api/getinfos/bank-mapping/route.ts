import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { getLoggedInUser } from '@/lib/actions/user.actions';

export async function GET() {
  try {
    // Verify user is authenticated using session
    const user = await getLoggedInUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Only allow transactor and admin roles to access transactor banks
    if (!["admin", "transactor"].includes(user.role || "")) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }
    // Resolve the path to the lib/json directory
    const filePath = path.join(process.cwd(), 'lib', 'json', 'batchBankList.json');
    const fileContents = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(fileContents);
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to load batchBankList.json', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
} 