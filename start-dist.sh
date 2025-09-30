#!/bin/bash

# JustDeviceCount - Production Build & Deploy Script
# Builds optimized dist folder and deploys with PM2
# Uses PostgreSQL database (server-side, not Neon)

set -e  # Exit on error

echo "🏗️  JustDeviceCount Production Build & Deploy"
echo "=============================================="

# Check prerequisites
echo ""
echo "📋 Checking prerequisites..."

if [ ! -f ".env" ]; then
    echo "❌ Error: .env file not found!"
    echo "   Create .env with DATABASE_URL before deploying."
    echo "   Example: DATABASE_URL=\"postgresql://user:pass@host:5432/crowd_index\""
    echo "   See DEVELOPER_GUIDE.md for details."
    exit 1
fi

if [ ! -d "security" ] || [ ! -f "security/cert.pem" ] || [ ! -f "security/cert.key" ]; then
    echo "⚠️  Warning: SSL certificates not found in security/ directory"
    echo "   Application requires security/cert.pem and security/cert.key"
    echo "   See DEVELOPER_GUIDE.md for SSL setup instructions."
fi

# Check PM2 installation
if ! command -v pm2 &> /dev/null; then
    echo "📦 Installing PM2..."
    npm install -g pm2
fi

# Generate Prisma Client
echo ""
echo "🔄 Generating Prisma Client..."
npx prisma generate

# Build the application
echo ""
echo "🔨 Building application bundle..."
npm run build

if [ $? -ne 0 ]; then
    echo "❌ Build failed! Check error messages above."
    exit 1
fi

echo "✅ Build completed successfully!"

# Copy essential files to dist
echo ""
echo "📦 Preparing dist folder..."

# Copy .env file
if [ -f "./.env" ]; then
    echo "   Copying .env file..."
    cp ./.env ./dist/.env
fi

# Copy security folder if it exists
if [ -d "./security" ]; then
    echo "   Copying SSL certificates..."
    mkdir -p ./dist/security
    cp -r ./security/* ./dist/security/
fi

# Install production dependencies in dist folder
echo ""
echo "📦 Installing production dependencies..."
cd dist
npm install --production --silent

if [ $? -ne 0 ]; then
    echo "❌ Dependency installation failed!"
    cd ..
    exit 1
fi

# Return to root directory
cd ..

# Stop existing dist instance if running
echo ""
echo "🔄 Preparing PM2 deployment..."
pm2 stop justdevicecount-dist 2>/dev/null || true
pm2 delete justdevicecount-dist 2>/dev/null || true

# Start with PM2
echo ""
echo "🚀 Starting JustDeviceCount from dist folder..."
npm run pm2:start:dist

# Save PM2 configuration
pm2 save

echo ""
echo "=============================================="
echo "✅ JustDeviceCount deployed successfully!"
echo ""
echo "📊 Access dashboard: https://your-server:3012/crowdindex/"
echo "📈 Monitor status: pm2 status"
echo "📋 View logs: pm2 logs justdevicecount-dist"
echo "🔍 Real-time monitor: pm2 monit"
echo ""
echo "To enable auto-restart on server reboot:"
echo "  pm2 startup"
echo "  pm2 save"
echo ""
