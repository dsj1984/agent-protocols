#!/bin/bash
# Description: Forwards Stripe webhooks to the local Cloudflare Worker environment.
# Prerequisite: Ensure stripe-cli is installed and authenticated.

echo "Starting Stripe webhook forwarding to local Hono API..."
echo "Ensure your worker is running on port 8787"

# Replace 8787 with the actual port your local Cloudflare worker uses
stripe listen --forward-to localhost:8787/v1/webhooks/stripe
