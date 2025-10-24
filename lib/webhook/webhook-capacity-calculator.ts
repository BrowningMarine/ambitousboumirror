import { log } from '../logger';

export interface RedisCommandAnalysis {
  commandsPerWebhook: {
    save: number;
    update: number;
    remove: number;
    recovery: number;
  };
  scenarioAnalysis: {
    successful: number;
    singleRetry: number;
    maxRetries: number;
  };
  monthlyCapacity: {
    perfectScenario: number;
    realistic: number;
    worstCase: number;
  };
  breakdown: string[];
}

/**
 * Calculate Redis command usage and processing capacity for webhook queue
 * 
 * UPSTASH FREE TIER: 500,000 commands per month
 * 
 * This calculator helps estimate how many webhook transactions can be processed
 * within the Redis command limit, considering different success/failure scenarios.
 */
export class WebhookCapacityCalculator {
  private readonly MONTHLY_COMMAND_LIMIT = 500000;
  private readonly DAYS_PER_MONTH = 30;
  
  /**
   * Analyze Redis command usage per webhook processing scenario
   */
  public analyzeCommandUsage(): RedisCommandAnalysis {
    const breakdown: string[] = [];
    
    // Base commands per webhook operation
    const commandsPerOperation = {
      save: 2,      // HSET + SADD (using pipeline)
      update: 1,    // HMSET 
      remove: 2,    // DEL + SREM (using pipeline)
      recovery: 1   // HGETALL per webhook during startup
    };
    
    breakdown.push('📊 Redis Commands Per Operation:');
    breakdown.push(`• Save webhook: ${commandsPerOperation.save} commands (HSET + SADD)`);
    breakdown.push(`• Update status: ${commandsPerOperation.update} command (HMSET)`);
    breakdown.push(`• Remove webhook: ${commandsPerOperation.remove} commands (DEL + SREM)`);
    breakdown.push(`• Recovery load: ${commandsPerOperation.recovery} command per webhook (HGETALL)`);
    breakdown.push('');
    
    // Scenario analysis
    const scenarios = {
      // Perfect scenario: Webhook succeeds on first try
      successful: commandsPerOperation.save + commandsPerOperation.remove, // 2 + 2 = 4 commands
      
      // Single retry scenario: Fails once, succeeds on retry
      singleRetry: commandsPerOperation.save + commandsPerOperation.update + commandsPerOperation.remove, // 2 + 1 + 2 = 5 commands
      
      // Worst case: Max retries (3 attempts) then permanent failure
      maxRetries: commandsPerOperation.save + (commandsPerOperation.update * 3) + commandsPerOperation.remove // 2 + 3 + 2 = 7 commands
    };
    
    breakdown.push('🎯 Scenario Analysis:');
    breakdown.push(`• Perfect (1st attempt success): ${scenarios.successful} commands`);
    breakdown.push(`• Single retry (2nd attempt success): ${scenarios.singleRetry} commands`);
    breakdown.push(`• Maximum retries (3 attempts, then fail): ${scenarios.maxRetries} commands`);
    breakdown.push('');
    
    // Monthly capacity calculations
    const monthlyCapacity = {
      perfectScenario: Math.floor(this.MONTHLY_COMMAND_LIMIT / scenarios.successful),
      realistic: Math.floor(this.MONTHLY_COMMAND_LIMIT / this.calculateRealisticAverage(scenarios)),
      worstCase: Math.floor(this.MONTHLY_COMMAND_LIMIT / scenarios.maxRetries)
    };
    
    breakdown.push('📈 Monthly Processing Capacity:');
    breakdown.push(`• Perfect scenario (100% success): ${monthlyCapacity.perfectScenario.toLocaleString()} webhooks/month`);
    breakdown.push(`• Realistic scenario (95% success): ${monthlyCapacity.realistic.toLocaleString()} webhooks/month`);
    breakdown.push(`• Worst case scenario (high failures): ${monthlyCapacity.worstCase.toLocaleString()} webhooks/month`);
    breakdown.push('');
    
    // Daily processing rates
    const dailyRates = {
      perfect: Math.floor(monthlyCapacity.perfectScenario / this.DAYS_PER_MONTH),
      realistic: Math.floor(monthlyCapacity.realistic / this.DAYS_PER_MONTH),
      worstCase: Math.floor(monthlyCapacity.worstCase / this.DAYS_PER_MONTH)
    };
    
    breakdown.push('📅 Daily Processing Rates:');
    breakdown.push(`• Perfect scenario: ${dailyRates.perfect.toLocaleString()} webhooks/day`);
    breakdown.push(`• Realistic scenario: ${dailyRates.realistic.toLocaleString()} webhooks/day`);
    breakdown.push(`• Worst case scenario: ${dailyRates.worstCase.toLocaleString()} webhooks/day`);
    breakdown.push('');
    
    // Hourly processing rates  
    const hourlyRates = {
      perfect: Math.floor(dailyRates.perfect / 24),
      realistic: Math.floor(dailyRates.realistic / 24),
      worstCase: Math.floor(dailyRates.worstCase / 24)
    };
    
    breakdown.push('⏱️ Hourly Processing Rates:');
    breakdown.push(`• Perfect scenario: ${hourlyRates.perfect.toLocaleString()} webhooks/hour`);
    breakdown.push(`• Realistic scenario: ${hourlyRates.realistic.toLocaleString()} webhooks/hour`);
    breakdown.push(`• Worst case scenario: ${hourlyRates.worstCase.toLocaleString()} webhooks/hour`);
    breakdown.push('');
    
    // Recovery overhead analysis
    breakdown.push('🔄 Recovery Overhead:');
    breakdown.push('• Startup recovery: 1 SMEMBERS + N HGETALL commands');
    breakdown.push('• If 100 pending webhooks at restart: 101 commands');
    breakdown.push('• Recovery cost is minimal compared to processing');
    breakdown.push('');
    
    // Optimization recommendations
    breakdown.push('⚡ Optimization Recommendations:');
    breakdown.push('• Use pipelines for atomic operations (already implemented)');
    breakdown.push('• Periodic cleanup of completed webhooks (already implemented)');
    breakdown.push('• Monitor success rates to optimize retry logic');
    breakdown.push('• Consider batch processing for high-volume periods');
    
    return {
      commandsPerWebhook: commandsPerOperation,
      scenarioAnalysis: scenarios,
      monthlyCapacity,
      breakdown
    };
  }
  
  /**
   * Calculate realistic average commands per webhook
   * Assumes 95% success rate, 4% single retry, 1% max retries
   */
  private calculateRealisticAverage(scenarios: { successful: number; singleRetry: number; maxRetries: number }): number {
    const weights = {
      successful: 0.95,   // 95% succeed on first try
      singleRetry: 0.04,  // 4% need one retry
      maxRetries: 0.01    // 1% need max retries
    };
    
    return (
      scenarios.successful * weights.successful +
      scenarios.singleRetry * weights.singleRetry +
      scenarios.maxRetries * weights.maxRetries
    );
  }
  
  /**
   * Estimate current command usage based on processing statistics
   */
  public estimateCurrentUsage(
    processedWebhooks: number,
    successRate: number,
    avgRetries: number
  ): {
    estimatedCommands: number;
    remainingCommands: number;
    projectedMonthlyUsage: number;
    canSustainCurrentRate: boolean;
  } {
    // Calculate average commands per webhook based on actual stats
    const baseCommands = 4; // Save + Remove
    const retryCommands = avgRetries * 1; // Updates
    const avgCommandsPerWebhook = baseCommands + retryCommands;
    
    const estimatedCommands = processedWebhooks * avgCommandsPerWebhook;
    const remainingCommands = this.MONTHLY_COMMAND_LIMIT - estimatedCommands;
    
    // Project monthly usage based on current rate
    const daysElapsed = new Date().getDate(); // Rough estimate
    const projectedMonthlyUsage = (estimatedCommands / daysElapsed) * this.DAYS_PER_MONTH;
    
    const canSustainCurrentRate = projectedMonthlyUsage <= this.MONTHLY_COMMAND_LIMIT;
    
    return {
      estimatedCommands,
      remainingCommands,
      projectedMonthlyUsage: Math.round(projectedMonthlyUsage),
      canSustainCurrentRate
    };
  }
  
  /**
   * Generate capacity report for monitoring
   */
  public async generateCapacityReport(): Promise<void> {
    const analysis = this.analyzeCommandUsage();
    
    await log.info('Webhook Queue Capacity Analysis', {
      monthlyLimit: this.MONTHLY_COMMAND_LIMIT,
      capacityEstimates: {
        perfectScenario: analysis.monthlyCapacity.perfectScenario,
        realisticScenario: analysis.monthlyCapacity.realistic,
        worstCase: analysis.monthlyCapacity.worstCase
      },
      dailyTargets: {
        perfectScenario: Math.floor(analysis.monthlyCapacity.perfectScenario / 30),
        realisticScenario: Math.floor(analysis.monthlyCapacity.realistic / 30),
        worstCase: Math.floor(analysis.monthlyCapacity.worstCase / 30)
      },
      recommendations: [
        'Monitor success rates to optimize capacity',
        'Use batch processing during high-volume periods',
        'Set up alerts when approaching command limits'
      ]
    });
    
    // Log detailed breakdown for debugging
    console.log('\n🎯 Upstash Redis Capacity Analysis:');
    analysis.breakdown.forEach(line => console.log(line));
  }
  
  /**
   * Check if current usage is approaching limits
   */
  public checkUsageLimits(currentCommands: number): {
    warningLevel: 'safe' | 'caution' | 'warning' | 'critical';
    message: string;
    suggestedActions: string[];
  } {
    const usagePercentage = (currentCommands / this.MONTHLY_COMMAND_LIMIT) * 100;
    
    if (usagePercentage < 50) {
      return {
        warningLevel: 'safe',
        message: `Redis usage at ${usagePercentage.toFixed(1)}% - well within limits`,
        suggestedActions: ['Continue normal operations']
      };
    } else if (usagePercentage < 75) {
      return {
        warningLevel: 'caution',
        message: `Redis usage at ${usagePercentage.toFixed(1)}% - monitor closely`,
        suggestedActions: [
          'Monitor webhook success rates',
          'Consider optimizing retry logic',
          'Plan for potential usage spikes'
        ]
      };
    } else if (usagePercentage < 90) {
      return {
        warningLevel: 'warning',
        message: `Redis usage at ${usagePercentage.toFixed(1)}% - approaching limits`,
        suggestedActions: [
          'Implement batch processing',
          'Reduce retry attempts if needed',
          'Consider upgrading Redis plan',
          'Monitor hourly usage patterns'
        ]
      };
    } else {
      return {
        warningLevel: 'critical',
        message: `Redis usage at ${usagePercentage.toFixed(1)}% - critical level`,
        suggestedActions: [
          'Immediate action required',
          'Switch to synchronous processing temporarily',
          'Upgrade Redis plan immediately',
          'Implement emergency rate limiting'
        ]
      };
    }
  }
}

// Export singleton instance
export const webhookCapacityCalculator = new WebhookCapacityCalculator();

// Helper function to run capacity analysis
export async function analyzeWebhookCapacity(): Promise<RedisCommandAnalysis> {
  const analysis = webhookCapacityCalculator.analyzeCommandUsage();
  await webhookCapacityCalculator.generateCapacityReport();
  return analysis;
} 