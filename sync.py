#!/usr/bin/env python3
"""
ADV Amazon Ledger - Keepa Sync & Monthly Sales Data Aggregator
Fetches price history, BSR, and sales estimates from Keepa API
Updates sync-data.json with latest product data for dashboard
"""

import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path
import subprocess

try:
    import requests
except ImportError:
    print("❌ requests library not installed. Run: pip install requests")
    sys.exit(1)

# Config
KEEPA_API_KEY = os.getenv("KEEPA_API_KEY", "")
WATCHLIST_FILE = "watchlist.json"
OUTPUT_FILE = "sync-data.json"
KEEPA_BASE_URL = "https://api.keepa.com/product"
KEEPA_BATCH_SIZE = 20
KEEPA_REQUEST_DELAY = 0.5  # seconds between requests (rate limiting)

def load_watchlist():
    """Load product list from watchlist.json"""
    if not Path(WATCHLIST_FILE).exists():
        print(f"❌ {WATCHLIST_FILE} not found")
        return []

    try:
        with open(WATCHLIST_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
        products = data.get("products", [])
        print(f"✅ Loaded {len(products)} products from watchlist")
        return products
    except Exception as e:
        print(f"❌ Error loading watchlist: {e}")
        return []

def get_asin_from_ean(ean):
    """Convert EAN to ASIN (if needed) - returns ASIN or original value"""
    # If already ASIN format (B + 9 chars), return as-is
    if ean.startswith('B') and len(ean) == 10:
        return ean
    return ean

def fetch_keepa_data(asin):
    """Fetch product data from Keepa API"""
    if not KEEPA_API_KEY:
        print("⚠️  KEEPA_API_KEY not set in environment")
        return None

    try:
        params = {
            "key": KEEPA_API_KEY,
            "asin": asin,
            "domain": "IT",  # Italy marketplace
            "stats": "90,365",  # Get 90-day and 365-day stats
            "offers": "20"  # Get top 20 offers
        }

        response = requests.get(KEEPA_BASE_URL, params=params, timeout=10)

        if response.status_code == 200:
            data = response.json()

            if data.get("products"):
                product = data["products"][0]
                return {
                    "asin": asin,
                    "title": product.get("title", ""),
                    "image": product.get("imagesCSV", "").split(",")[0] if product.get("imagesCSV") else "",
                    "bsr": product.get("stats", {}).get("90", {}).get("avg", 0),
                    "bsr_category": product.get("categoryTree", [{}])[-1].get("name", "") if product.get("categoryTree") else "",
                    "price_current": product.get("stats", {}).get("current", [0])[-1] / 100 if product.get("stats", {}).get("current") else 0,
                    "price_avg_90": product.get("stats", {}).get("90", {}).get("avg", 0) / 100 if product.get("stats", {}).get("90") else 0,
                    "sales_est_90": product.get("stats", {}).get("90", {}).get("sales", 0),
                    "sales_est_365": product.get("stats", {}).get("365", {}).get("sales", 0),
                    "buybox_current": product.get("buyBoxUsesAmazonLogistics", False),
                    "last_updated": datetime.now().isoformat()
                }
            else:
                print(f"  ⚠️  No data returned for {asin}")
                return None
        elif response.status_code == 429:
            print(f"  🔴 Rate limited (429) - waiting 60s...")
            time.sleep(60)
            return fetch_keepa_data(asin)  # Retry
        else:
            print(f"  ❌ Error {response.status_code}: {response.text[:100]}")
            return None

    except Exception as e:
        print(f"  ❌ Exception: {e}")
        return None

def sync_keepa_data(products):
    """Fetch Keepa data for all products"""
    print(f"\n📡 Fetching Keepa data for {len(products)} products...")

    keepa_data = {}
    successful = 0
    failed = 0

    for idx, product in enumerate(products, 1):
        asin = product.get("asin", "").strip()

        if not asin:
            print(f"  ⚠️  [{idx}/{len(products)}] No ASIN - skipping")
            failed += 1
            continue

        print(f"  [{idx}/{len(products)}] {asin}...", end=" ", flush=True)
        data = fetch_keepa_data(asin)

        if data:
            keepa_data[asin] = data
            print("✅")
            successful += 1
        else:
            print("❌")
            failed += 1

        # Rate limiting
        if idx < len(products):
            time.sleep(KEEPA_REQUEST_DELAY)

    print(f"\n✅ Keepa sync complete: {successful} successful, {failed} failed\n")
    return keepa_data

def build_sync_data(products, keepa_data):
    """Build comprehensive sync data structure for dashboard"""
    sync_data = {
        "metadata": {
            "last_sync": datetime.now().isoformat(),
            "source": "Keepa API",
            "total_products": len(products),
            "products_enriched": len(keepa_data)
        },
        "products": []
    }

    for product in products:
        asin = product.get("asin", "").strip()
        keepa_info = keepa_data.get(asin, {})

        product_entry = {
            "asin": asin,
            "sku": product.get("sku", ""),
            "name": keepa_info.get("title") or product.get("name", ""),
            "brand": product.get("brand", ""),
            "image": keepa_info.get("image", ""),
            "keepa": {
                "bsr": keepa_info.get("bsr", 0),
                "bsr_category": keepa_info.get("bsr_category", ""),
                "price_current": keepa_info.get("price_current", 0),
                "price_avg_90d": keepa_info.get("price_avg_90", 0),
                "sales_est_90d": keepa_info.get("sales_est_90", 0),
                "sales_est_365d": keepa_info.get("sales_est_365", 0),
                "last_updated": keepa_info.get("last_updated", "")
            },
            "monthly_sales": {
                "units": 0,
                "revenue": 0,
                "buybox_pct": 0
            }
        }

        sync_data["products"].append(product_entry)

    return sync_data

def save_sync_data(sync_data):
    """Write sync data to file"""
    try:
        with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
            json.dump(sync_data, f, indent=2, ensure_ascii=False)
        print(f"💾 Saved {OUTPUT_FILE}")
        return True
    except Exception as e:
        print(f"❌ Error saving {OUTPUT_FILE}: {e}")
        return False

def main():
    """Main sync routine"""
    print("=" * 60)
    print("ADV Amazon Ledger - Keepa Sync")
    print("=" * 60)

    # Load products
    products = load_watchlist()
    if not products:
        print("❌ No products to sync")
        return False

    # Fetch Keepa data
    keepa_data = sync_keepa_data(products)

    # Build sync file
    sync_data = build_sync_data(products, keepa_data)

    # Save
    if save_sync_data(sync_data):
        print("\n✅ Sync complete!")
        return True
    else:
        print("\n❌ Sync failed")
        return False

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
