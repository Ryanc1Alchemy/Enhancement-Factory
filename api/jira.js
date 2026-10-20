import { parseBody, jsonResponse, errorResponse } from './_lib/parseBody.js';

// ============================================================
// Jira REST integration — gate 6 commit phase
// ============================================================
// If the JIRA_* env vars are not set, this endpoint returns a graceful
// "simulated" response so gates 1-5 still demo perfectly. The README explains
// how to wire in a real Jira project.
// ============================================================

function jiraConfigured() {
  return Boolean(
    process.env.JIRA_BASE_URL &&
    process.env.JIRA_EMAIL &&
    process.env.JIRA_API_TOKEN &&
    process.env.JIRA_PROJECT_KEY
  );
}

function isLiveEnabled() {
  // Safety switch for implementation/testing phases.
  // Default OFF unless explicitly set to "true".
  return String(process.env.JIRA_LIVE_ENABLED || '').toLowerCase() === 'true';
}

function allowedIssueTypes() {
  return String(process.env.JIRA_ALLOWED_ISSUE_TYPES || 'Story,Epic')
    .split(',')
    .map(x => x.trim())
    .filter(Boolean);
}

function normalizedIssueType(input) {
  const requested = String(input || '').trim();
  return requested || 'Story';
}

function authHeader() {
  const token = Buffer.from(
    `${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`
  ).toString('base64');
  return `Basic ${token}`;
}

// Convert plain text + Gherkin into Atlassian Document Format (ADF) — Jira Cloud's
// preferred description format. We keep this minimal: paragraphs with line breaks.
function toADF(text) {
  const blocks = String(text || '').split(/\n\n+/);
  return {
    version: 1,
    type: 'doc',
    content: blocks.filter(b => b.trim()).map(block => ({
      type: 'paragraph',
      content: [{ type: 'text', text: block }]
    }))
  };
}

export async function createTicket(payload) {
  const issueType = normalizedIssueType(payload.issue_type);
  const allowed = allowedIssueTypes();
  if (!allowed.some(t => t.toLowerCase() === issueType.toLowerCase())) {
    return {
      mode: 'error',
      error: `Issue type "${issueType}" is not allowed`,
      detail: `Allowed issue types: ${allowed.join(', ')}`
    };
  }

  if (!isLiveEnabled() || !jiraConfigured()) {
    return {
      mode: 'simulated',
      reason:
        'Jira environment variables are not set. The payload below is what would have been sent. ' +
        'Live Jira is disabled or Jira environment variables are not set. ' +
        'Set JIRA_LIVE_ENABLED=true and configure JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY in Vercel to enable real ticket creation.',
      simulated_ticket: {
        key: `${process.env.JIRA_PROJECT_KEY || 'GWDEMO'}-XXXX`,
        url: '#',
        payload
      }
    };
  }

  const url = `${process.env.JIRA_BASE_URL}/rest/api/3/issue`;

  const fullDescription = [
    payload.description || '',
    '',
    'Acceptance Criteria',
    '',
    payload.acceptance_criteria_text || ''
  ].join('\n');

  const body = {
    fields: {
      project: { key: process.env.JIRA_PROJECT_KEY },
      summary: payload.summary,
      description: toADF(fullDescription),
      issuetype: { name: issueType },
      labels: payload.labels || [],
      // Components must already exist in the Jira project. If they don't, the call
      // fails — handled below with a clean fallback.
      components: (payload.components || []).map(name => ({ name }))
    }
  };

  // Story points custom field varies by Jira instance — there is no universal
  // field ID across Jira Cloud sites. customfield_10016 is a common default,
  // but configurable via JIRA_STORY_POINTS_FIELD so this can be reused for a
  // different client's Jira project without a code change. We still tolerate
  // failure (fallback below) if it's not the right field for a given site.
  const storyPointsField = process.env.JIRA_STORY_POINTS_FIELD || 'customfield_10016';
  const tryWithStoryPoints = {
    ...body,
    fields: { ...body.fields, [storyPointsField]: payload.story_points }
  };

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: authHeader(),
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(tryWithStoryPoints)
    });

    if (!response.ok) {
      // Retry without components & story points if Jira rejected the payload —
      // the demo project may not have those configured.
      const fallbackBody = {
        fields: {
          project: body.fields.project,
          summary: body.fields.summary,
          description: body.fields.description,
          issuetype: body.fields.issuetype,
          labels: body.fields.labels
        }
      };
      response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: authHeader(),
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(fallbackBody)
      });
    }
  } catch (err) {
    return {
      mode: 'error',
      error: 'Network error reaching Jira',
      detail: err.message
    };
  }

  if (!response.ok) {
    let detail = '';
    try {
      detail = await response.text();
    } catch (_) {}
    return {
      mode: 'error',
      error: `Jira returned ${response.status}`,
      detail
    };
  }

  const data = await response.json();
  const ticket = {
    key: data.key,
    id: data.id,
    url: `${process.env.JIRA_BASE_URL}/browse/${data.key}`
  };

  let link_result = null;
  const contextIssueKey = String(process.env.JIRA_CONTEXT_ISSUE_KEY || '').trim();
  if (contextIssueKey) {
    const linkType = String(process.env.JIRA_LINK_TYPE || 'Relates').trim();
    const linkResponse = await fetch(`${process.env.JIRA_BASE_URL}/rest/api/3/issueLink`, {
      method: 'POST',
      headers: {
        Authorization: authHeader(),
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type: { name: linkType },
        inwardIssue: { key: ticket.key },
        outwardIssue: { key: contextIssueKey }
      })
    });

    if (!linkResponse.ok) {
      let detail = '';
      try { detail = await linkResponse.text(); } catch (_) {}
      link_result = {
        ok: false,
        error: `Issue created, but linking failed (${linkResponse.status})`,
        detail
      };
    } else {
      link_result = {
        ok: true,
        type: linkType,
        target: contextIssueKey
      };
    }
  }

  return {
    mode: 'live',
    issue_type: issueType,
    context_issue_key: contextIssueKey || null,
    ticket,
    link_result
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return errorResponse(res, 405, 'Method not allowed');
  }

  try {
    const body = await parseBody(req);
    const payload = body.payload;
    if (!payload) {
      return errorResponse(res, 400, 'Missing payload');
    }
    const result = await createTicket(payload);
    return jsonResponse(res, 200, result);
  } catch (err) {
    return errorResponse(res, 500, 'Jira integration error', err.message);
  }
}
