#!/bin/bash

# JustDeviceCount - Production Dist Startup Script
# This script builds and starts the application from the dist folder

echo "Building JustDeviceCount for production..."

# Build the application
npm run build

if [ $? -ne 0 ]; then
    echo "Build failed! Please check the error messages above."
    exit 1
fi

echo "Build completed successfully!"

# Check if .env file exists in dist directory, if not copy from root
if [ ! -f "./dist/.env" ] && [ -f "./.env" ]; then
    echo "Copying .env file to dist directory..."
    cp ./.env ./dist/.env
fi

# Install production dependencies in dist folder
echo "Installing production dependencies in dist folder..."
cd dist
npm install --production --silent

# Return to root directory
cd ..

echo "Starting JustDeviceCount from dist folder..."

# Start with PM2
npm run pm2:start:dist

echo "JustDeviceCount started from dist folder!"
echo "Check status with: pm2 status"
echo "View logs with: pm2 logs justdevicecount-dist"
