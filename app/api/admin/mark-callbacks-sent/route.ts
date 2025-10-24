import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { createAdminClient } from '@/lib/appwrite/appwrite.actions';
import { appwriteConfig } from '@/lib/appwrite/appwrite-config';
import { Query } from 'appwrite';

const DATABASE_ID = appwriteConfig.databaseId;
const ODRTRANS_COLLECTION_ID = appwriteConfig.odrtransCollectionId;

/**
 * Admin API: Mark Failed Callbacks as Sent (Manual Cleanup)
 * 
 * Use this endpoint to manually mark transactions with unreachable callback URLs
 * as "sent" so they stop being retried by the cron job.
 * 
 * POST /api/admin/mark-callbacks-sent
 * Authorization: Bearer {INTERNAL_API_SECRET}
 * 
 * Body:
 * {
 *   "odrIds": ["ABO-001", "ABO-002"],           // Option 1: Specific order IDs
 *   "urlPattern": "staging-api.esomarvietnam"  // Option 2: Mark all matching this pattern
 * }
 */
export async function POST(request: Request) {
  try {
    // Verify authorization
    const headersList = await headers();
    const authHeader = headersList.get('authorization') || '';
    const internalApiSecret = authHeader.replace('Bearer ', '');

    if (!internalApiSecret || (process.env.INTERNAL_API_SECRET && internalApiSecret !== process.env.INTERNAL_API_SECRET)) {
      console.log('❌ Unauthorized access attempt to mark-callbacks-sent');
      return NextResponse.json(
        { success: false, message: 'Unauthorized: Invalid or missing API secret' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { odrIds, urlPattern } = body;

    if (!odrIds && !urlPattern) {
      return NextResponse.json(
        { success: false, message: 'Either odrIds or urlPattern is required' },
        { status: 400 }
      );
    }

    const { database } = await createAdminClient();
    const results = {
      updated: 0,
      failed: 0,
      details: [] as Array<{ odrId: string; success: boolean; message: string }>
    };

    // Option 1: Mark specific order IDs
    if (odrIds && Array.isArray(odrIds)) {
      console.log(`📝 Marking ${odrIds.length} specific orders as sent...`);

      for (const odrId of odrIds) {
        try {
          // Find transaction by odrId
          const transactions = await database.listDocuments(
            DATABASE_ID,
            ODRTRANS_COLLECTION_ID,
            [Query.equal('odrId', odrId)]
          );

          if (transactions.documents.length === 0) {
            results.failed++;
            results.details.push({
              odrId,
              success: false,
              message: 'Transaction not found'
            });
            continue;
          }

          const transaction = transactions.documents[0];

          // Update flag
          await database.updateDocument(
            DATABASE_ID,
            ODRTRANS_COLLECTION_ID,
            transaction.$id,
            { isSentCallbackNotification: true }
          );

          console.log(`✅ Marked ${odrId} as sent`);
          results.updated++;
          results.details.push({
            odrId,
            success: true,
            message: 'Marked as sent'
          });
        } catch (error) {
          console.error(`❌ Failed to mark ${odrId}:`, error);
          results.failed++;
          results.details.push({
            odrId,
            success: false,
            message: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }
    }

    // Option 2: Mark all matching URL pattern
    if (urlPattern) {
      console.log(`📝 Marking all transactions with URL pattern: ${urlPattern}...`);

      try {
        // Find all transactions with unsent callbacks
        // Note: Appwrite Query.contains() may not work reliably, so we fetch all and filter in code
        const allTransactions = await database.listDocuments(
          DATABASE_ID,
          ODRTRANS_COLLECTION_ID,
          [
            Query.equal('isSentCallbackNotification', false),
            Query.isNotNull('urlCallBack'),
            Query.limit(100) // Safety limit
          ]
        );

        console.log(`Fetched ${allTransactions.documents.length} unsent callbacks, filtering by pattern...`);

        // Filter by URL pattern in code (more reliable than Appwrite query)
        const transactions = {
          documents: allTransactions.documents.filter(doc => {
            const txData = doc as unknown as { urlCallBack?: string };
            return txData.urlCallBack && txData.urlCallBack.includes(urlPattern);
          })
        };

        console.log(`Found ${transactions.documents.length} transactions matching pattern "${urlPattern}"`);

        for (const transaction of transactions.documents) {
          try {
            await database.updateDocument(
              DATABASE_ID,
              ODRTRANS_COLLECTION_ID,
              transaction.$id,
              { isSentCallbackNotification: true }
            );

            const txData = transaction as unknown as { odrId?: string; urlCallBack?: string };
            const odrId = txData.odrId || transaction.$id;
            console.log(`✅ Marked ${odrId} as sent (URL: ${txData.urlCallBack})`);
            results.updated++;
            results.details.push({
              odrId,
              success: true,
              message: `Marked as sent (pattern matched: ${urlPattern})`
            });
          } catch (error) {
            const txData = transaction as unknown as { odrId?: string };
            const odrId = txData.odrId || transaction.$id;
            console.error(`❌ Failed to mark ${odrId}:`, error);
            results.failed++;
            results.details.push({
              odrId,
              success: false,
              message: error instanceof Error ? error.message : 'Unknown error'
            });
          }
        }
      } catch (error) {
        console.error('❌ Error querying transactions:', error);
        return NextResponse.json(
          {
            success: false,
            message: `Query failed: ${error instanceof Error ? error.message : 'Unknown error'}`
          },
          { status: 500 }
        );
      }
    }

    console.log(`✅ Cleanup completed: ${results.updated} updated, ${results.failed} failed`);

    return NextResponse.json({
      success: true,
      message: `Marked ${results.updated} transactions as sent, ${results.failed} failed`,
      updated: results.updated,
      failed: results.failed,
      details: results.details
    });

  } catch (error) {
    console.error('❌ Error in mark-callbacks-sent:', error);
    return NextResponse.json(
      {
        success: false,
        message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
      },
      { status: 500 }
    );
  }
}
