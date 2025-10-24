// Define the progress tracker type
export interface ResendProgress {
    total: number;
    processed: number;
    success: number;
    failed: number;
    inProgress: boolean;
    lastUpdated: Date;
    errors: string[];
}

// Create a singleton instance to store progress
let resendProgress: ResendProgress = {
    total: 0,
    processed: 0,
    success: 0,
    failed: 0,
    inProgress: false,
    lastUpdated: new Date(),
    errors: []
};

/**
 * Get the current progress state
 */
export function getResendProgress(): ResendProgress {
    return resendProgress;
}

/**
 * Update the progress state
 */
export function updateResendProgress(progress: ResendProgress): void {
    resendProgress = { ...progress };
}

/**
 * Reset the progress to initial state with inProgress = true
 */
export function resetResendProgress(): void {
    resendProgress = {
        total: 0,
        processed: 0,
        success: 0,
        failed: 0,
        inProgress: true,
        lastUpdated: new Date(),
        errors: []
    };
} 