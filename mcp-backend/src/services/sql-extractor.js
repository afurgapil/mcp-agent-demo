const CHANNEL_SEGMENT_REGEX = /<\|channel\|>[^>]*>([\s\S]*?)(?=(?:\n[^\n]*<\|channel\|>|$))/gi;
const SQL_STATEMENT_REGEX = /(SELECT|INSERT|UPDATE|DELETE|WITH|SHOW|DESCRIBE|EXPLAIN|CALL)[\s\S]*?;/i;
const SQL_FALLBACK_REGEX = /(SELECT|INSERT|UPDATE|DELETE|WITH|SHOW|DESCRIBE|EXPLAIN|CALL)[\s\S]*/i;

function takeLastChannelBlock(text) {
  if (!text.includes("<|channel|>")) return text;

  const finalBlocks = Array.from(
    text.matchAll(/<\|channel\|>\s*final[^>]*>([\s\S]*?)(?=(?:\n[^\n]*<\|channel\|>|$))/gi)
  );
  if (finalBlocks.length) {
    return finalBlocks[finalBlocks.length - 1][1].trim();
  }

  const allBlocks = Array.from(text.matchAll(CHANNEL_SEGMENT_REGEX));
  if (allBlocks.length) {
    return allBlocks[allBlocks.length - 1][1].trim();
  }

  const lastMarker = text.lastIndexOf(">");
  if (lastMarker >= 0) {
    const candidate = text.slice(lastMarker + 1).trim();
    if (candidate) return candidate;
  }

  return text.trim();
}

function stripMarkers(text) {
  return text
    .replace(/<\|start\|>|<\|end\|>|<\|im_start\|>|<\|im_end\|>/gi, " ")
    .replace(/(?:assistant|user|system)?<\|channel\|>[^>]*>/gi, " ")
    .replace(/<\|[^>]+\|>/g, " ")
    .replace(/\|>/g, " ")
    .replace(/<\|/g, " ")
    .replace(/\u00a0/g, " ");
}

function stripLeadingLabels(text) {
  return text
    .replace(/^[^A-Za-z0-9]*(SQL\s*(statement)?(?:\s*only)?\s*[:\-]?)/i, "")
    .replace(/^[^A-Za-z0-9]*(Output\s*[:\-]?)/i, "")
    .replace(/^[^A-Za-z0-9]*(Query\s*[:\-]?)/i, "")
    .replace(/^[^A-Za-z0-9]*(Answer\s*[:\-]?)/i, "")
    .replace(/^[^A-Za-z0-9]*(Response\s*[:\-]?)/i, "")
    .trim();
}

function cleanupSqlWhitespace(sql) {
  let result = sql
    .replace(/\r\n?|\n/g, "\n")
    .replace(/\t/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  result = result
    .replace(/\*\*/g, "")
    .replace(/(\w)\*(\w)/g, "$1$2")
    .replace(/([A-Za-z0-9_])\*(?=[^A-Za-z0-9_])/g, "$1")
    .replace(/\\`/g, "`")
    .replace(/\\_/g, "_")
    .replace(/\\\*/g, "*")
    .replace(/\\%/g, "%")
    .replace(/\\-/g, "-")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\\\/g, "\\")
    .replace(/\\([.,;])/g, "$1")
    .replace(/\\\s/g, " ");

  result = result.replace(/[ \t]+\n/g, "\n").trim();

  if (result && !/;\s*$/.test(result)) {
    result = `${result.replace(/\s+$/g, "")};`;
  }

  return result;
}

export function extractSqlFromText(rawText) {
  if (!rawText || typeof rawText !== "string") return "";

  let candidate = rawText.trim();
  candidate = takeLastChannelBlock(candidate);
  candidate = stripMarkers(candidate).trim();

  const fenced = candidate.match(/```(?:sql)?\s*([\s\S]*?)```/i);
  if (fenced) {
    candidate = fenced[1].trim();
  }

  candidate = stripLeadingLabels(candidate);

  const statementMatch = candidate.match(SQL_STATEMENT_REGEX);
  if (statementMatch) {
    const snippet = candidate.slice(
      statementMatch.index,
      statementMatch.index + statementMatch[0].length
    );
    return cleanupSqlWhitespace(snippet);
  }

  const fallbackMatch = candidate.match(SQL_FALLBACK_REGEX);
  if (fallbackMatch) {
    return cleanupSqlWhitespace(fallbackMatch[0]);
  }

  return "";
}

export default extractSqlFromText;
