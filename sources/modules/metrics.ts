// Re-export local-only metrics system for complete data sovereignty
export {
    LocalCounter as Counter,
    LocalGauge as Gauge,
    LocalHistogram as Histogram,
    register,
    getLocalMetricsRegistry,
    exportPrometheusFormat
} from './localMetrics';

import { db } from '@/storage/db';
import { forever } from '@/utils/forever';
import { delay } from '@/utils/delay';
import { shutdownSignal } from '@/utils/shutdown';
import {
    LocalCounter,
    LocalGauge,
    LocalHistogram,
    register
} from './localMetrics';

// Application metrics - now using local-only system
export const websocketConnectionsGauge = new LocalGauge(
    'websocket_connections_total',
    'Number of active WebSocket connections',
    ['type']
);

export const sessionAliveEventsCounter = new LocalCounter(
    'session_alive_events_total',
    'Total number of session-alive events'
);

export const machineAliveEventsCounter = new LocalCounter(
    'machine_alive_events_total',
    'Total number of machine-alive events'
);

export const sessionCacheCounter = new LocalCounter(
    'session_cache_operations_total',
    'Total session cache operations',
    ['operation', 'result']
);

export const databaseUpdatesSkippedCounter = new LocalCounter(
    'database_updates_skipped_total',
    'Number of database updates skipped due to debouncing',
    ['type']
);

export const websocketEventsCounter = new LocalCounter(
    'websocket_events_total',
    'Total WebSocket events received by type',
    ['event_type']
);

export const httpRequestsCounter = new LocalCounter(
    'http_requests_total',
    'Total number of HTTP requests',
    ['method', 'route', 'status']
);

export const httpRequestDurationHistogram = new LocalHistogram(
    'http_request_duration_seconds',
    'HTTP request duration in seconds',
    ['method', 'route', 'status'],
    [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10]
);

export const databaseRecordCountGauge = new LocalGauge(
    'database_records_total',
    'Total number of records in database tables',
    ['table']
);

// WebSocket connection tracking
const connectionCounts = {
    'user-scoped': 0,
    'session-scoped': 0,
    'machine-scoped': 0
};

export function incrementWebSocketConnection(type: 'user-scoped' | 'session-scoped' | 'machine-scoped'): void {
    connectionCounts[type]++;
    websocketConnectionsGauge.set({ type }, connectionCounts[type]);
}

export function decrementWebSocketConnection(type: 'user-scoped' | 'session-scoped' | 'machine-scoped'): void {
    connectionCounts[type] = Math.max(0, connectionCounts[type] - 1);
    websocketConnectionsGauge.set({ type }, connectionCounts[type]);
}

// Database metrics updater
export async function updateDatabaseMetrics(): Promise<void> {
    // Query counts for each table
    const [accountCount, sessionCount, messageCount, machineCount] = await Promise.all([
        db.account.count(),
        db.session.count(),
        db.sessionMessage.count(),
        db.machine.count()
    ]);

    // Update metrics
    databaseRecordCountGauge.set({ table: 'accounts' }, accountCount);
    databaseRecordCountGauge.set({ table: 'sessions' }, sessionCount);
    databaseRecordCountGauge.set({ table: 'messages' }, messageCount);
    databaseRecordCountGauge.set({ table: 'machines' }, machineCount);
}

export function startDatabaseMetricsUpdater(): void {
    forever('database-metrics-updater', async () => {
        await updateDatabaseMetrics();
        
        // Wait 60 seconds before next update
        await delay(60 * 1000, shutdownSignal);
    });
}

// register is already exported at the top of the file