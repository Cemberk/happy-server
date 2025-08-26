/**
 * Local-Only Metrics System
 * Replaces Prometheus with privacy-focused local metrics collection
 * Data stays within Nebula network - no external metric services
 */

import { db } from '@/storage/db';
import { forever } from '@/utils/forever';
import { delay } from '@/utils/delay';
import { shutdownSignal } from '@/utils/shutdown';

// Local metrics storage interface
interface MetricRecord {
    name: string;
    type: 'counter' | 'gauge' | 'histogram';
    value: number;
    labels: Record<string, string>;
    timestamp: number;
}

interface HistogramRecord {
    name: string;
    buckets: Record<string, number>;
    sum: number;
    count: number;
    timestamp: number;
}

// In-memory metrics storage (local only)
class LocalMetricsRegistry {
    private counters = new Map<string, { value: number, labels: Record<string, string> }>();
    private gauges = new Map<string, { value: number, labels: Record<string, string> }>();
    private histograms = new Map<string, HistogramRecord>();
    private metrics: MetricRecord[] = [];

    // Counter methods
    incrementCounter(name: string, labels: Record<string, string> = {}, value: number = 1): void {
        const key = this.getLabeledKey(name, labels);
        const existing = this.counters.get(key) || { value: 0, labels };
        existing.value += value;
        this.counters.set(key, existing);
        
        this.recordMetric({
            name,
            type: 'counter',
            value: existing.value,
            labels,
            timestamp: Date.now()
        });
    }

    // Gauge methods
    setGauge(name: string, labels: Record<string, string> = {}, value: number): void {
        const key = this.getLabeledKey(name, labels);
        this.gauges.set(key, { value, labels });
        
        this.recordMetric({
            name,
            type: 'gauge',
            value,
            labels,
            timestamp: Date.now()
        });
    }

    // Histogram methods
    observeHistogram(name: string, labels: Record<string, string> = {}, value: number, buckets: number[] = []): void {
        const key = this.getLabeledKey(name, labels);
        let histogram = this.histograms.get(key);
        
        if (!histogram) {
            histogram = {
                name,
                buckets: {},
                sum: 0,
                count: 0,
                timestamp: Date.now()
            };
        }

        histogram.sum += value;
        histogram.count += 1;
        
        // Update buckets
        const defaultBuckets = buckets.length > 0 ? buckets : [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10];
        for (const bucket of defaultBuckets) {
            if (value <= bucket) {
                histogram.buckets[bucket.toString()] = (histogram.buckets[bucket.toString()] || 0) + 1;
            }
        }
        
        histogram.timestamp = Date.now();
        this.histograms.set(key, histogram);
    }

    private getLabeledKey(name: string, labels: Record<string, string>): string {
        const labelStr = Object.entries(labels)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => `${k}="${v}"`)
            .join(',');
        return labelStr ? `${name}{${labelStr}}` : name;
    }

    private recordMetric(metric: MetricRecord): void {
        this.metrics.push(metric);
        
        // Keep only last 10,000 metrics to prevent memory bloat
        if (this.metrics.length > 10000) {
            this.metrics = this.metrics.slice(-5000); // Keep last 5k
        }
    }

    // Export methods for local viewing
    exportMetrics(since?: number): MetricRecord[] {
        const sinceTimestamp = since || 0;
        return this.metrics.filter(m => m.timestamp >= sinceTimestamp);
    }

    getCounters(): Record<string, { value: number, labels: Record<string, string> }> {
        return Object.fromEntries(this.counters);
    }

    getGauges(): Record<string, { value: number, labels: Record<string, string> }> {
        return Object.fromEntries(this.gauges);
    }

    getHistograms(): Record<string, HistogramRecord> {
        return Object.fromEntries(this.histograms);
    }

    // Clear all metrics (for testing/reset)
    clear(): void {
        this.counters.clear();
        this.gauges.clear();
        this.histograms.clear();
        this.metrics = [];
    }

    // Get metrics summary
    getSummary(): { counters: number, gauges: number, histograms: number, totalEvents: number } {
        return {
            counters: this.counters.size,
            gauges: this.gauges.size,
            histograms: this.histograms.size,
            totalEvents: this.metrics.length
        };
    }
}

// Global registry instance
const localRegistry = new LocalMetricsRegistry();

// Local metric classes (backward compatible with Prometheus interface)
export class LocalCounter {
    constructor(
        private name: string,
        private help: string,
        private labelNames: string[] = []
    ) {}

    inc(labels?: Record<string, string>, value?: number): void {
        localRegistry.incrementCounter(this.name, labels || {}, value || 1);
    }

    get(labels?: Record<string, string>): number {
        const counters = localRegistry.getCounters();
        const key = this.getLabeledKey(this.name, labels || {});
        return counters[key]?.value || 0;
    }

    private getLabeledKey(name: string, labels: Record<string, string>): string {
        const labelStr = Object.entries(labels)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => `${k}="${v}"`)
            .join(',');
        return labelStr ? `${name}{${labelStr}}` : name;
    }
}

export class LocalGauge {
    constructor(
        private name: string,
        private help: string,
        private labelNames: string[] = []
    ) {}

    set(labels: Record<string, string>, value: number): void {
        localRegistry.setGauge(this.name, labels, value);
    }

    get(labels?: Record<string, string>): number {
        const gauges = localRegistry.getGauges();
        const key = this.getLabeledKey(this.name, labels || {});
        return gauges[key]?.value || 0;
    }

    private getLabeledKey(name: string, labels: Record<string, string>): string {
        const labelStr = Object.entries(labels)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => `${k}="${v}"`)
            .join(',');
        return labelStr ? `${name}{${labelStr}}` : name;
    }
}

export class LocalHistogram {
    constructor(
        private name: string,
        private help: string,
        private labelNames: string[] = [],
        private buckets: number[] = [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10]
    ) {}

    observe(labels: Record<string, string>, value: number): void {
        localRegistry.observeHistogram(this.name, labels, value, this.buckets);
    }
}

// Application metrics - same interface as before but local-only
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

// Connection tracking (unchanged interface)
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

// Database metrics updater (unchanged)
export async function updateDatabaseMetrics(): Promise<void> {
    const [accountCount, sessionCount, messageCount, machineCount] = await Promise.all([
        db.account.count(),
        db.session.count(),
        db.sessionMessage.count(),
        db.machine.count()
    ]);

    databaseRecordCountGauge.set({ table: 'accounts' }, accountCount);
    databaseRecordCountGauge.set({ table: 'sessions' }, sessionCount);
    databaseRecordCountGauge.set({ table: 'messages' }, messageCount);
    databaseRecordCountGauge.set({ table: 'machines' }, machineCount);
}

export function startDatabaseMetricsUpdater(): void {
    forever('database-metrics-updater', async () => {
        await updateDatabaseMetrics();
        await delay(60 * 1000, shutdownSignal);
    });
}

// Local metrics API endpoints (for viewing within Nebula network)
export function getLocalMetricsRegistry(): LocalMetricsRegistry {
    return localRegistry;
}

// Export metrics in Prometheus format for compatibility
export function exportPrometheusFormat(): string {
    const lines: string[] = [];
    const timestamp = Date.now();
    
    // Export counters
    const counters = localRegistry.getCounters();
    for (const [key, data] of Object.entries(counters)) {
        const labelStr = Object.entries(data.labels)
            .map(([k, v]) => `${k}="${v}"`)
            .join(',');
        const metricLine = labelStr ? `${key.split('{')[0]}{${labelStr}} ${data.value} ${timestamp}` : `${key} ${data.value} ${timestamp}`;
        lines.push(metricLine);
    }
    
    // Export gauges
    const gauges = localRegistry.getGauges();
    for (const [key, data] of Object.entries(gauges)) {
        const labelStr = Object.entries(data.labels)
            .map(([k, v]) => `${k}="${v}"`)
            .join(',');
        const metricLine = labelStr ? `${key.split('{')[0]}{${labelStr}} ${data.value} ${timestamp}` : `${key} ${data.value} ${timestamp}`;
        lines.push(metricLine);
    }
    
    return lines.join('\n');
}

// Backward compatibility - empty register for imports that expect it
export const register = {
    metrics: () => exportPrometheusFormat(),
    clear: () => localRegistry.clear(),
    getSingleMetric: () => null
};