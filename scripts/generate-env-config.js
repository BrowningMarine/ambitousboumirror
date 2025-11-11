#!/usr/bin/env node
/**
 * Helper script to generate APPCONFIG_JSON environment variable value
 * 
 * Usage:
 *   node scripts/generate-env-config.js
 *   node scripts/generate-env-config.js --minify
 *   node scripts/generate-env-config.js --output=.env.production
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const shouldMinify = args.includes('--minify');
const outputArg = args.find(arg => arg.startsWith('--output'));
const outputFile = outputArg ? outputArg.split('=')[1] : null;

// Read the config file
const configPath = path.join(process.cwd(), 'lib', 'json', 'appconfig.json');

if (!fs.existsSync(configPath)) {
  console.error('❌ Config file not found:', configPath);
  process.exit(1);
}

try {
  const configContent = fs.readFileSync(configPath, 'utf-8');
  const config = JSON.parse(configContent);
  
  // Format JSON
  const jsonString = shouldMinify 
    ? JSON.stringify(config)
    : JSON.stringify(config, null, 2);
  
  console.log('\n📋 Copy this value to APPCONFIG_JSON environment variable:\n');
  console.log('─'.repeat(80));
  console.log(jsonString);
  console.log('─'.repeat(80));
  
  if (outputFile) {
    const envContent = `APPCONFIG_JSON='${jsonString.replace(/'/g, "\\'")}'`;
    fs.writeFileSync(outputFile, envContent);
    console.log(`\n✅ Written to ${outputFile}`);
  }
  
  console.log('\n📝 Next steps:');
  console.log('1. Copy the JSON above');
  console.log('2. Go to Vercel/Render Dashboard → Environment Variables');
  console.log('3. Add/Update APPCONFIG_JSON with the copied value');
  console.log('4. Save and redeploy');
  console.log('\n💡 This ensures zero blob storage costs for config reads!\n');
  
} catch (error) {
  console.error('❌ Error reading config:', error.message);
  process.exit(1);
}
