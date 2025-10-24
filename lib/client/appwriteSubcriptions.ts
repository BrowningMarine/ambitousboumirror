"use client";

import { client } from '@/lib/appwrite/appwrite-client';
import { RealtimeResponseEvent } from 'appwrite';

// Generic type T to handle different document types  
export const subscribeToCollection = <T extends { $id?: string }>(
  databaseId: string,
  collectionId: string,
  onCreate?: (document: T) => void,
  onUpdate?: (document: T) => void,
  onDelete?: (documentId: string) => void
): (() => void) => {


  // Enhanced debounce mechanism to prevent rapid successive calls
  let lastCallTime = 0;
  let lastDocumentId = '';
  const DEBOUNCE_DELAY = 1000; // 1 second debounce
  const SAME_DOCUMENT_DEBOUNCE = 2000; // 2 seconds for same document

  // Subscribe to specific database and collection  
  const subscription = client.subscribe(
    `databases.${databaseId}.collections.${collectionId}.documents`,
    (response: RealtimeResponseEvent<T>) => {
  

      // Filter out non-document events
      const documentEvents = response.events.filter(event => 
        event.includes('databases.') && 
        event.includes('collections.') && 
        event.includes('documents.') &&
        (event.endsWith('.create') || event.endsWith('.update') || event.endsWith('.delete'))
      );

      if (documentEvents.length === 0) {
        return;
      }

      const eventType = documentEvents[0];
      const document = response.payload;

      // Validate that we have a proper document
      if (!document || typeof document !== 'object') {
        return;
      }

      // Enhanced debounce for rapid calls and same document updates
      const now = Date.now();
      const currentDocumentId = document.$id || '';
      
      // Use longer debounce for same document, shorter for different documents
      const debounceTime = currentDocumentId === lastDocumentId ? SAME_DOCUMENT_DEBOUNCE : DEBOUNCE_DELAY;
      
      if (now - lastCallTime < debounceTime) {
        return;
      }
      
      lastCallTime = now;
      lastDocumentId = currentDocumentId;

      if (eventType.endsWith('.create') && onCreate) {
        onCreate(document);
      } else if (eventType.endsWith('.update') && onUpdate) {
        onUpdate(document);
      } else if (eventType.endsWith('.delete') && onDelete && document.$id) {
        onDelete(document.$id);
      }
    }
  );



  return () => {
    subscription();
  };
};

// NEW OPTIMIZED FUNCTION: Subscribe only to specific documents in a collection
// This is much more efficient for bandwidth and performance
export const subscribeToCollectionDocuments = <T extends { $id?: string }>(
  databaseId: string,
  collectionId: string,
  documentIds: string[],
  onUpdate: (document: T) => void,
  onDelete?: (documentId: string) => void
): (() => void) => {
  if (!documentIds.length) return () => { };

  // Create an array of channel strings, one for each document
  const channels = documentIds.map(id =>
    `databases.${databaseId}.collections.${collectionId}.documents.${id}`
  );

  // Subscribe only to the specific documents we care about
  const subscription = client.subscribe(
    channels,
    (response: RealtimeResponseEvent<T>) => {
      // Check if it's an update event (the most common for visible transactions)
      if (response.events.some(event => event.endsWith('.update'))) {
        const updatedDocument = response.payload;
        onUpdate(updatedDocument);
      }
      // Handle delete events
      else if (response.events.some(event => event.endsWith('.delete')) && onDelete) {
        const deletedDocument = response.payload;
        // Extract document ID from the event payload or from the channel string
        // For delete events, sometimes the payload doesn't contain the full document
        if (deletedDocument && deletedDocument.$id) {
          onDelete(deletedDocument.$id);
        } else {
          // Extract the ID from the channel that received the event
          // The channel format is: databases.{dbId}.collections.{colId}.documents.{docId}
          const channel = response.channels[0];
          const docId = channel.split('.').pop();
          if (docId) {
            onDelete(docId);
          }
        }
      }
    }
  );

  return () => {
    subscription();
  };
};

// Subscribe to multiple collections  
export const subscribeToCollections = <T extends { $id?: string }>(
  subscriptions: Array<{
    databaseId: string;
    collectionId: string;
    onCreate?: (document: T) => void;
    onUpdate?: (document: T) => void;
    onDelete?: (documentId: string) => void;
  }>
): (() => void) => {
  const unsubscribeFunctions = subscriptions.map(subscription =>
    subscribeToCollection<T>(
      subscription.databaseId,
      subscription.collectionId,
      subscription.onCreate,
      subscription.onUpdate,
      subscription.onDelete
    )
  );

  // Return function that unsubscribes from all subscriptions  
  return () => {
    unsubscribeFunctions.forEach(unsubscribe => unsubscribe());
  };
};