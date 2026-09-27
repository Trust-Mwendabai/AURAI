/**
 * Export utilities for CSV, Excel, and chart images
 */
import { getToken } from './apiClient';

// Mirrors apiClient's base: ../api relative to the built app (dist/ and
// api/ are siblings), overridable for the Vite dev server via VITE_API_URL.
// A plain '/api/...' path 404s once the app is deployed under a subdirectory.
const API_URL = (import.meta.env.VITE_API_URL as string) || '../api';

function authHeaders(): HeadersInit {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function exportForecastAsCSV(predictionId: string, forecastName: string) {
  try {
    const response = await fetch(`${API_URL}/export/forecast/${predictionId}/csv`, {
      headers: authHeaders(),
    });
    if (!response.ok) throw new Error('Failed to export');

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `forecast_${slugify(forecastName)}_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('CSV export failed:', error);
    throw error;
  }
}

export async function exportDatasetAsCSV(datasetId: string, datasetName: string) {
  try {
    const response = await fetch(`${API_URL}/export/dataset/${datasetId}/csv`, {
      headers: authHeaders(),
    });
    if (!response.ok) throw new Error('Failed to export');

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dataset_${slugify(datasetName)}_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('CSV export failed:', error);
    throw error;
  }
}

export async function exportChartAsImage(
  elementId: string,
  fileName: string,
  format: 'png' | 'svg' = 'png'
) {
  try {
    const element = document.getElementById(elementId);
    if (!element) throw new Error('Chart element not found');

    // Match the page's current theme so exported charts don't look inverted
    const resolvedBg = getComputedStyle(document.body).backgroundColor || '#0b0b12';

    // Use html2canvas for PNG export
    const { default: html2canvas } = await import('html2canvas');
    const canvas = await html2canvas(element, {
      backgroundColor: resolvedBg,
      scale: 2, // Higher quality
      useCORS: true,
    });

    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!)));
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chart_${slugify(fileName)}_${new Date().toISOString().split('T')[0]}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Chart export failed:', error);
    throw error;
  }
}

/**
 * Convert text to URL-friendly slug
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
    .replace(/^-+|-+$/g, '');
}
