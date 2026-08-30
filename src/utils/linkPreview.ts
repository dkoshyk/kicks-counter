/**
 * Link metadata scraper utility for Shopping Wishlist
 * Extracts OpenGraph, Twitter Cards, Title, and Price metadata from product URLs.
 */

export interface LinkMetadata {
  url: string;
  domain: string;
  title: string;
  description?: string;
  imageUrl?: string;
  price?: number;
  currency: string;
}

/**
 * Extracts hostname domain for clean display (e.g. 'rozetka.com.ua')
 */
export function extractDomain(urlStr: string): string {
  try {
    const parsed = new URL(urlStr.startsWith('http') ? urlStr : `https://${urlStr}`);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return 'магазин';
  }
}

/**
 * Parses numeric price from string or raw text (e.g. "1 450 грн", "$45.99")
 */
/**
 * Parses numeric price from string or raw text (e.g. "1 450 грн", "1299,00₴", "₴ 499.99", "$45.99")
 */
export function extractPriceFromString(text: string): { price?: number; currency: string } {
  let currency = 'UAH';
  if (/[$]|usd/i.test(text)) currency = 'USD';
  else if ([/€/i, /eur/i].some(r => r.test(text))) currency = 'EUR';
  else if ([/грн/i, /₴/i, /uah/i].some(r => r.test(text))) currency = 'UAH';

  // Specific regex for prices with currency symbol or word nearby:
  // e.g. "1 450 грн", "1.450,00 грн", "Ціна: 899 ₴", "450.00₴"
  const priceWithCurrencyRegexes = [
    /(?:ціна|price|вартість)?[:\s]*([\d\s.,]+)\s*(?:грн|uah|₴)/i,
    /(?:грн|uah|₴)\s*([\d\s.,]+)/i,
    /[$]\s*([\d\s.,]+)/i,
    /([\d\s.,]+)\s*[$]/i,
    /€\s*([\d\s.,]+)/i,
    /([\d\s.,]+)\s*€/i
  ];

  for (const reg of priceWithCurrencyRegexes) {
    const match = text.match(reg);
    if (match && match[1]) {
      const cleaned = match[1]
        .replace(/&nbsp;|\s/g, '')
        .replace(',', '.');
      const val = parseFloat(cleaned);
      if (!isNaN(val) && val > 0 && val < 5000000) {
        return { price: val, currency };
      }
    }
  }

  // General number extractor if text is very short (e.g. "1299" or "450.50")
  if (text.length < 30) {
    const cleaned = text.replace(/&nbsp;|\s/g, '').replace(',', '.');
    const match = cleaned.match(/(\d+(\.\d{1,2})?)/);
    if (match) {
      const val = parseFloat(match[1]);
      if (!isNaN(val) && val > 0 && val < 5000000) {
        return { price: val, currency };
      }
    }
  }

  return { currency };
}

/**
 * Extracts schema.org JSON-LD Product price and details from HTML string
 */
function extractJsonLdProduct(doc: Document): { price?: number; currency?: string; image?: string; title?: string } | null {
  try {
    const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
    for (const s of scripts) {
      const content = s.textContent?.trim();
      if (!content) continue;

      try {
        const json = JSON.parse(content);
        const findProduct = (obj: any): any => {
          if (!obj || typeof obj !== 'object') return null;
          if (obj['@type'] === 'Product' || (Array.isArray(obj['@type']) && obj['@type'].includes('Product'))) {
            return obj;
          }
          if (Array.isArray(obj)) {
            for (const it of obj) {
              const res = findProduct(it);
              if (res) return res;
            }
          }
          if (obj['@graph'] && Array.isArray(obj['@graph'])) {
            for (const it of obj['@graph']) {
              const res = findProduct(it);
              if (res) return res;
            }
          }
          return null;
        };

        const prod = findProduct(json);
        if (prod) {
          let price: number | undefined;
          let currency: string | undefined;

          // Offers can be single object or array
          const offers = Array.isArray(prod.offers) ? prod.offers[0] : prod.offers;
          if (offers) {
            if (offers.price) {
              const p = typeof offers.price === 'number' ? offers.price : parseFloat(offers.price.toString().replace(/[^0-9.]/g, ''));
              if (!isNaN(p)) price = p;
            } else if (offers.lowPrice) {
              const p = typeof offers.lowPrice === 'number' ? offers.lowPrice : parseFloat(offers.lowPrice.toString().replace(/[^0-9.]/g, ''));
              if (!isNaN(p)) price = p;
            }
            if (offers.priceCurrency) {
              currency = offers.priceCurrency;
            }
          }

          let image: string | undefined;
          if (typeof prod.image === 'string') image = prod.image;
          else if (Array.isArray(prod.image) && prod.image.length > 0) {
            image = typeof prod.image[0] === 'string' ? prod.image[0] : prod.image[0]?.url;
          } else if (prod.image?.url) {
            image = prod.image.url;
          }

          return {
            price,
            currency,
            image,
            title: prod.name
          };
        }
      } catch {
        // Continue to next JSON-LD script
      }
    }
  } catch {
    // DOM parse failure
  }
  return null;
}

/**
 * Primary scraper using Microlink API, with fallback to AllOrigins CORS Proxy
 */
export async function fetchLinkMetadata(rawUrl: string): Promise<LinkMetadata> {
  let normalizedUrl = rawUrl.trim();
  if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
    normalizedUrl = `https://${normalizedUrl}`;
  }

  const domain = extractDomain(normalizedUrl);
  let defaultTitle = `Товар із ${domain}`;

  // Strategy 1: Microlink API with extended extraction
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 7000);

    const apiUrl = `https://api.microlink.io?url=${encodeURIComponent(normalizedUrl)}&palette=false&data.price.selector=[itemprop="price"],.product-price,.price,.price_value,[data-qaid="product_price"],.product__price`;
    const response = await fetch(apiUrl, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (response.ok) {
      const resData = await response.json();
      if (resData.status === 'success' && resData.data) {
        const data = resData.data;

        let price: number | undefined;
        let currency = 'UAH';

        // Check if microlink returned price
        if (data.price) {
          if (typeof data.price === 'number') {
            price = data.price;
          } else if (typeof data.price === 'string') {
            const p = extractPriceFromString(data.price);
            if (p.price) {
              price = p.price;
              if (p.currency) currency = p.currency;
            }
          }
        }

        // Try extracting price from title, description, or publisher
        if (!price) {
          for (const txt of [data.title, data.description]) {
            if (txt) {
              const extracted = extractPriceFromString(txt);
              if (extracted.price) {
                price = extracted.price;
                currency = extracted.currency;
                break;
              }
            }
          }
        }

        let imageUrl = data.image?.url;
        // Fix relative image URLs
        if (imageUrl && !imageUrl.startsWith('http')) {
          try {
            imageUrl = new URL(imageUrl, normalizedUrl).href;
          } catch {
            // Keep as is
          }
        }

        return {
          url: normalizedUrl,
          domain: data.publisher || domain,
          title: data.title || defaultTitle,
          description: data.description || undefined,
          imageUrl: imageUrl || undefined,
          price,
          currency
        };
      }
    }
  } catch (err) {
    console.warn('Microlink scraper failed, trying fallback proxy:', err);
  }

  // Strategy 2: CORS proxy (AllOrigins) + JSON-LD Schema + OpenGraph + DOM Selectors
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 7000);

    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(normalizedUrl)}`;
    const response = await fetch(proxyUrl, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (response.ok) {
      const json = await response.json();
      const htmlText = json.contents;

      if (htmlText && typeof htmlText === 'string') {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlText, 'text/html');

        // Check JSON-LD first (most reliable for e-commerce)
        const jsonLd = extractJsonLdProduct(doc);

        const getMeta = (propOrName: string) => {
          const el =
            doc.querySelector(`meta[property="${propOrName}"]`) ||
            doc.querySelector(`meta[name="${propOrName}"]`) ||
            doc.querySelector(`meta[itemprop="${propOrName}"]`);
          return el?.getAttribute('content') || undefined;
        };

        const ogTitle = jsonLd?.title || getMeta('og:title') || getMeta('twitter:title') || doc.querySelector('title')?.textContent;
        const ogDesc = getMeta('og:description') || getMeta('twitter:description') || getMeta('description');
        let ogImage = jsonLd?.image || getMeta('og:image') || getMeta('twitter:image');

        if (ogImage && !ogImage.startsWith('http')) {
          try {
            ogImage = new URL(ogImage, normalizedUrl).href;
          } catch {
            // Keep as is
          }
        }

        let price = jsonLd?.price;
        let currency = jsonLd?.currency || 'UAH';

        // Check standard meta tags for price
        if (!price) {
          const rawPrice =
            getMeta('product:price:amount') ||
            getMeta('og:price:amount') ||
            getMeta('price') ||
            getMeta('product:price');

          if (rawPrice) {
            const p = parseFloat(rawPrice.replace(/[^0-9.]/g, ''));
            if (!isNaN(p) && p > 0) price = p;
          }
          const curMeta = getMeta('product:price:currency') || getMeta('og:price:currency');
          if (curMeta) currency = curMeta;
        }

        // Check common Ukrainian e-commerce price DOM selectors (Rozetka, Prom, MA, Chicco, etc.)
        if (!price) {
          const priceSelectors = [
            '[itemprop="price"]',
            '.product-price__big',
            '.product-prices__big',
            '.product__price',
            '.price_value',
            '.current-price',
            '.product-price',
            '[data-qaid="product_price"]',
            '.price'
          ];

          for (const sel of priceSelectors) {
            const el = doc.querySelector(sel);
            if (el && el.textContent) {
              const valStr = el.getAttribute('content') || el.textContent;
              const extracted = extractPriceFromString(valStr);
              if (extracted.price) {
                price = extracted.price;
                if (extracted.currency) currency = extracted.currency;
                break;
              }
            }
          }
        }

        // Try extracting from description/title as last resort
        if (!price && (ogDesc || ogTitle)) {
          const extracted = extractPriceFromString(`${ogTitle || ''} ${ogDesc || ''}`);
          if (extracted.price) {
            price = extracted.price;
            currency = extracted.currency;
          }
        }

        return {
          url: normalizedUrl,
          domain,
          title: ogTitle?.trim() || defaultTitle,
          description: ogDesc?.trim() || undefined,
          imageUrl: ogImage?.trim() || undefined,
          price,
          currency: currency.toUpperCase()
        };
      }
    }
  } catch (fallbackErr) {
    console.warn('AllOrigins fallback also failed:', fallbackErr);
  }

  // Strategy 3: Graceful fallback with clean domain
  return {
    url: normalizedUrl,
    domain,
    title: defaultTitle,
    currency: 'UAH'
  };
}
