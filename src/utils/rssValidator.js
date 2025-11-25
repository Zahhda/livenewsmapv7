// src/utils/rssValidator.js
import Parser from 'rss-parser';

const parser = new Parser({ 
  timeout: 10000, 
  requestOptions: { 
    timeout: 10000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
  } 
});

// Validate RSS URL format
export function isValidRSSUrl(url) {
  try {
    const urlObj = new URL(url);
    return ['http:', 'https:'].includes(urlObj.protocol);
  } catch {
    return false;
  }
}

// Validate RSS feed content
export async function validateRSSFeed(url) {
  const result = {
    isValid: false,
    hasContent: false,
    itemCount: 0,
    error: null,
    feedTitle: null,
    lastItemDate: null,
    sampleItems: [],
    feedDescription: null,
    feedLink: null,
    responseTime: 0,
    feedType: null,
    validationDetails: {
      urlFormat: false,
      feedStructure: false,
      hasItems: false,
      hasRecentContent: false,
      feedTitle: false,
      responseTime: false,
      contentType: false
    }
  };

  const startTime = Date.now();

  try {
    // Check URL format first
    if (!isValidRSSUrl(url)) {
      result.error = 'Invalid URL format - must be http:// or https://';
      return result;
    }
    result.validationDetails.urlFormat = true;

    // Try to parse the RSS feed with enhanced error handling
    const feed = await parser.parseURL(url);
    
    if (!feed) {
      result.error = 'Failed to parse RSS feed - no data returned';
      return result;
    }

    // Check basic feed structure
    if (!feed.items || !Array.isArray(feed.items)) {
      result.error = 'Invalid RSS structure - no items array found';
      return result;
    }
    result.validationDetails.feedStructure = true;

    // Determine feed type
    if (feed.feedUrl && feed.feedUrl.includes('atom')) {
      result.feedType = 'Atom';
    } else if (feed.feedUrl && feed.feedUrl.includes('rss')) {
      result.feedType = 'RSS';
    } else {
      result.feedType = 'Unknown';
    }

    // Check if feed has content
    result.hasContent = feed.items.length > 0;
    result.itemCount = feed.items.length;
    result.feedTitle = feed.title || 'Unknown Feed';
    result.feedDescription = feed.description || null;
    result.feedLink = feed.link || null;
    
    if (result.hasContent) {
      result.validationDetails.hasItems = true;
    }
    
    if (result.feedTitle && result.feedTitle !== 'Unknown Feed') {
      result.validationDetails.feedTitle = true;
    }
    
    // Get sample items (first 5 for better analysis)
    result.sampleItems = feed.items.slice(0, 5).map(item => ({
      title: item.title || 'No title',
      link: item.link || '',
      pubDate: item.pubDate || item.isoDate || null,
      content: item.content || item.summary || '',
      guid: item.guid || null
    }));

    // Check for recent content (within last 7 days for more strict validation)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const recentItems = feed.items.filter(item => {
      const itemDate = new Date(item.pubDate || item.isoDate || 0);
      return itemDate > sevenDaysAgo;
    });

    // Also check for items within last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const monthlyItems = feed.items.filter(item => {
      const itemDate = new Date(item.pubDate || item.isoDate || 0);
      return itemDate > thirtyDaysAgo;
    });

    // Calculate response time
    result.responseTime = Date.now() - startTime;
    result.validationDetails.responseTime = result.responseTime < 10000; // Less than 10 seconds

    // Enhanced validation logic
    if (recentItems.length > 0) {
      result.lastItemDate = recentItems[0].pubDate || recentItems[0].isoDate;
      result.validationDetails.hasRecentContent = true;
      result.isValid = true;
    } else if (monthlyItems.length > 0) {
      result.lastItemDate = monthlyItems[0].pubDate || monthlyItems[0].isoDate;
      result.validationDetails.hasRecentContent = false;
      result.isValid = true;
      result.error = 'Warning: No content in last 7 days, but has content within 30 days';
    } else if (result.hasContent) {
      result.isValid = true;
      result.error = 'Warning: Feed has content but no recent items (older than 30 days)';
    } else {
      result.error = 'No content found in RSS feed';
    }

    // Additional validation checks
    if (result.isValid) {
      // Check if items have proper structure
      const itemsWithTitles = feed.items.filter(item => item.title && item.title.trim().length > 0);
      const itemsWithLinks = feed.items.filter(item => item.link && item.link.trim().length > 0);
      
      if (itemsWithTitles.length < feed.items.length * 0.5) {
        result.error = (result.error || '') + ' Warning: Many items missing titles';
      }
      
      if (itemsWithLinks.length < feed.items.length * 0.5) {
        result.error = (result.error || '') + ' Warning: Many items missing links';
      }
    }

    // Provide detailed error messages
    if (!result.isValid && !result.error) {
      const issues = [];
      if (!result.validationDetails.urlFormat) issues.push('Invalid URL format');
      if (!result.validationDetails.feedStructure) issues.push('Invalid RSS structure');
      if (!result.validationDetails.hasItems) issues.push('No RSS items found');
      if (!result.validationDetails.hasRecentContent) issues.push('No recent content');
      if (!result.validationDetails.feedTitle) issues.push('Missing feed title');
      if (!result.validationDetails.responseTime) issues.push('Slow response time');
      
      result.error = issues.join(', ');
    }

  } catch (error) {
    console.error('RSS validation error:', error);
    
    result.responseTime = Date.now() - startTime;
    
    if (error.code === 'ENOTFOUND') {
      result.error = 'URL not found (404) - check if the feed URL is correct';
    } else if (error.code === 'ECONNREFUSED') {
      result.error = 'Connection refused - server may be down';
    } else if (error.code === 'ETIMEDOUT') {
      result.error = 'Request timed out - server is too slow';
    } else if (error.message.includes('Invalid XML')) {
      result.error = 'Invalid RSS/XML format - not a valid RSS feed';
    } else if (error.message.includes('Feed not recognized')) {
      result.error = 'Not a valid RSS feed - check URL format';
    } else if (error.message.includes('CORS')) {
      result.error = 'CORS error - feed blocks cross-origin requests';
    } else if (error.message.includes('SSL')) {
      result.error = 'SSL/TLS error - certificate issue';
    } else if (error.message.includes('timeout')) {
      result.error = 'Request timeout - feed took too long to respond';
    } else if (error.message.includes('ENOTFOUND')) {
      result.error = 'Domain not found - check if the website exists';
    } else if (error.message.includes('ECONNRESET')) {
      result.error = 'Connection reset by server - try again later';
    } else {
      result.error = error.message || 'Unknown error occurred';
    }
  }

  return result;
}

// Validate multiple RSS feeds in parallel
export async function validateMultipleRSSFeeds(urls) {
  const validationPromises = urls.map(async (url) => {
    const validation = await validateRSSFeed(url);
    return { url, ...validation };
  });

  return Promise.all(validationPromises);
}
