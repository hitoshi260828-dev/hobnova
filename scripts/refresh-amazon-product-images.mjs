/**
 * Amazon Creators API product-image refresh hook.
 *
 * This file intentionally does not call the API yet.
 * Enable it only after the Associates account is eligible for Creators API access
 * and the required credentials have been created.
 *
 * Intended flow:
 * 1. Read products with amazonAsin from src/data/projectors.ts.
 * 2. Request the Amazon Creators API image resource for those ASINs.
 * 3. Use only image URLs returned by the API; never scrape Amazon product pages.
 * 4. Update amazonImageUrl and amazonImageCheckedAt in src/data/projectors.ts.
 * 5. Commit the data-only change through a scheduled/manual GitHub workflow.
 *
 * Required secret names will be added only when credentials are actually issued,
 * so we do not lock the repository to an unverified credential schema.
 */

console.log('[amazon-images] Creators API integration is prepared but not enabled.');
console.log('[amazon-images] No network request was made and no product data was changed.');
