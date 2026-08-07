/* ==========================================================================
   artifacts.js — document rendering, chart generation and file export
   Zero dependencies. Everything runs locally in the browser.
   ========================================================================== */

(function (global) {
  "use strict";

  /* ---------------------------------------------------------------- utils */

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function slug(s) {
    return String(s || "artifact")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "artifact";
  }

  function stamp() {
    var d = new Date();
    var p = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes());
  }

  /* ------------------------------------------------------ syntax highlight */

  var KEYWORDS = /\b(const|let|var|function|return|if|else|for|while|class|new|import|export|from|async|await|try|catch|throw|typeof|instanceof|this|null|undefined|true|false|def|elif|lambda|None|True|False|public|private|static|void|int|string|bool|select|from|where|group|order|by|insert|update|delete)\b/gi;

  function highlight(code) {
    var out = esc(code);
    var slots = [];
    // The "K" prefix keeps the index digits glued to a word character so the
    // later numeric pass cannot match inside a placeholder.
    function stash(html) { slots.push(html); return "\u0000K" + (slots.length - 1) + "\u0000"; }

    // Comments and strings first so keywords inside them are left alone.
    out = out.replace(/(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/)/g, function (m) {
      return stash('<span class="tok-com">' + m + "</span>");
    });
    out = out.replace(/(&quot;[^&]*?&quot;|&#39;[^&]*?&#39;|`[^`]*?`)/g, function (m) {
      return stash('<span class="tok-str">' + m + "</span>");
    });
    out = out.replace(KEYWORDS, function (m) {
      return stash('<span class="tok-key">' + m + "</span>");
    });
    out = out.replace(/\b(\d+\.?\d*)\b/g, function (m) {
      return stash('<span class="tok-num">' + m + "</span>");
    });

    return out.replace(/\u0000K(\d+)\u0000/g, function (_, i) { return slots[+i]; });
  }

  /* ------------------------------------------------------------- markdown */

  function inline(s) {
    var out = esc(s);
    out = out.replace(/`([^`]+)`/g, function (_, c) { return "<code>" + c + "</code>"; });
    out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img src="$2" alt="$1">');
    out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    out = out.replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>");
    out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
    out = out.replace(/~~([^~]+)~~/g, "<del>$1</del>");
    return out;
  }

  function splitRow(line) {
    return line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map(function (c) { return c.trim(); });
  }

  /**
   * Render a useful subset of GitHub-flavoured Markdown to HTML.
   * Supports: fenced code, ATX headings, tables, blockquotes, ordered and
   * unordered lists, task lists, horizontal rules and inline formatting.
   */
  function markdown(src) {
    var lines = String(src == null ? "" : src).replace(/\r\n?/g, "\n").split("\n");
    var html = [];
    var i = 0;

    function listBlock(ordered) {
      var tag = ordered ? "ol" : "ul";
      var items = [];
      var re = ordered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/;
      while (i < lines.length && re.test(lines[i])) {
        var text = lines[i].match(re)[1];
        var task = text.match(/^\[([ xX])\]\s+(.*)$/);
        if (task) {
          items.push('<li class="task"><input type="checkbox" disabled' +
            (task[1].toLowerCase() === "x" ? " checked" : "") + "> " + inline(task[2]) + "</li>");
        } else {
          items.push("<li>" + inline(text) + "</li>");
        }
        i++;
      }
      html.push("<" + tag + ">" + items.join("") + "</" + tag + ">");
    }

    while (i < lines.length) {
      var line = lines[i];

      // Fenced code
      var fence = line.match(/^\s*```(\w*)/);
      if (fence) {
        var lang = fence[1];
        var buf = [];
        i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++;
        html.push('<pre data-lang="' + esc(lang) + '"><code>' + highlight(buf.join("\n")) + "</code></pre>");
        continue;
      }

      // Table: header row followed by a separator row
      if (/\|/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
        var head = splitRow(line);
        i += 2;
        var body = [];
        while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim() !== "") {
          body.push(splitRow(lines[i])); i++;
        }
        html.push("<table><thead><tr>" +
          head.map(function (c) { return "<th>" + inline(c) + "</th>"; }).join("") +
          "</tr></thead><tbody>" +
          body.map(function (r) {
            return "<tr>" + r.map(function (c) { return "<td>" + inline(c) + "</td>"; }).join("") + "</tr>";
          }).join("") +
          "</tbody></table>");
        continue;
      }

      var h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) { var lv = h[1].length; html.push("<h" + lv + ">" + inline(h[2]) + "</h" + lv + ">"); i++; continue; }

      if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) { html.push("<hr>"); i++; continue; }

      if (/^\s*>\s?/.test(line)) {
        var q = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) { q.push(lines[i].replace(/^\s*>\s?/, "")); i++; }
        html.push("<blockquote>" + markdown(q.join("\n")) + "</blockquote>");
        continue;
      }

      if (/^\s*[-*+]\s+/.test(line)) { listBlock(false); continue; }
      if (/^\s*\d+[.)]\s+/.test(line)) { listBlock(true); continue; }

      if (line.trim() === "") { i++; continue; }

      // Paragraph: gather until a blank line or the start of another block
      var para = [];
      while (i < lines.length && lines[i].trim() !== "" &&
             !/^\s*(#{1,6}\s|```|>|[-*+]\s|\d+[.)]\s)/.test(lines[i])) {
        para.push(lines[i]); i++;
      }
      if (para.length) html.push("<p>" + inline(para.join("\n")) + "</p>");
      else i++;
    }

    return html.join("\n");
  }

  /* ------------------------------------------------------------ data parse */

  /** Parse CSV/TSV text, honouring quoted fields. */
  function parseDelimited(text) {
    var t = String(text).trim();
    if (!t) return [];
    var delim = (t.split("\n")[0].match(/\t/g) || []).length >= (t.split("\n")[0].match(/,/g) || []).length ? "\t" : ",";
    var rows = [], row = [], cur = "", q = false;

    for (var i = 0; i < t.length; i++) {
      var c = t[i];
      if (q) {
        if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += c;
      } else if (c === '"') { q = true; }
      else if (c === delim) { row.push(cur.trim()); cur = ""; }
      else if (c === "\n") { row.push(cur.trim()); rows.push(row); row = []; cur = ""; }
      else if (c !== "\r") { cur += c; }
    }
    row.push(cur.trim());
    if (row.length > 1 || row[0] !== "") rows.push(row);
    return rows;
  }

  /**
   * Turn CSV, TSV, JSON or "Label: value" lines into { labels, series }.
   */
  function parseDataset(text) {
    var raw = String(text || "").trim();
    if (!raw) throw new Error("No data provided.");

    // JSON: array of objects, array of pairs, or a plain object
    if (/^[[{]/.test(raw)) {
      var json = JSON.parse(raw);
      if (!Array.isArray(json)) {
        var lbl = Object.keys(json);
        return { labels: lbl, series: [{ name: "Value", values: lbl.map(function (k) { return Number(json[k]) || 0; }) }] };
      }
      if (json.length && typeof json[0] === "object" && !Array.isArray(json[0])) {
        var keys = Object.keys(json[0]);
        var labelKey = keys[0];
        var numKeys = keys.slice(1).filter(function (k) { return json.some(function (r) { return isFinite(Number(r[k])); }); });
        if (!numKeys.length) throw new Error("No numeric columns found in the JSON.");
        return {
          labels: json.map(function (r) { return String(r[labelKey]); }),
          series: numKeys.map(function (k) {
            return { name: k, values: json.map(function (r) { return Number(r[k]) || 0; }) };
          })
        };
      }
      // Array of [label, value] or plain numbers
      return {
        labels: json.map(function (r, n) { return Array.isArray(r) ? String(r[0]) : "Item " + (n + 1); }),
        series: [{ name: "Value", values: json.map(function (r) { return Number(Array.isArray(r) ? r[1] : r) || 0; }) }]
      };
    }

    // "Label: value" lines
    if (/^[^,\t\n]+:\s*-?\d/.test(raw) && !/[,\t]/.test(raw.split("\n")[0])) {
      var pairs = raw.split("\n").filter(Boolean).map(function (l) {
        var m = l.split(":");
        return [m[0].trim(), Number(m.slice(1).join(":").trim()) || 0];
      });
      return {
        labels: pairs.map(function (p) { return p[0]; }),
        series: [{ name: "Value", values: pairs.map(function (p) { return p[1]; }) }]
      };
    }

    // Delimited
    var rows = parseDelimited(raw).filter(function (r) { return r.length && r.join("").trim() !== ""; });
    if (rows.length < 2) throw new Error("Need a header row plus at least one data row.");
    var header = rows[0];
    var data = rows.slice(1);
    var cols = [];
    for (var c = 1; c < header.length; c++) {
      if (data.some(function (r) { return isFinite(parseFloat(r[c])); })) cols.push(c);
    }
    if (!cols.length) throw new Error("No numeric columns found. Put labels in column 1 and numbers after.");
    return {
      labels: data.map(function (r) { return r[0] || ""; }),
      series: cols.map(function (c) {
        return {
          name: header[c] || "Series " + c,
          values: data.map(function (r) { return parseFloat(r[c]) || 0; })
        };
      })
    };
  }

  /* ---------------------------------------------------------------- charts */

  var PALETTE = ["#C96442", "#4C6EF5", "#3F8F5F", "#B7852B", "#7A5AF8", "#D6336C", "#0CA678", "#F76707"];

  function svgEl(tag, attrs, text) {
    var a = Object.keys(attrs).map(function (k) { return k + '="' + String(attrs[k]).replace(/"/g, "&quot;") + '"'; });
    var open = "<" + tag + (a.length ? " " + a.join(" ") : "");
    return text === undefined ? open + "/>" : open + ">" + esc(text) + "</" + tag + ">";
  }

  function niceStep(range, target) {
    var raw = range / Math.max(1, target);
    var mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    var norm = raw / mag;
    var step = norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1;
    return step * mag;
  }

  function fmtNum(n) {
    var abs = Math.abs(n);
    if (abs >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, "") + "B";
    if (abs >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
    if (abs >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "k";
    return String(Math.round(n * 100) / 100);
  }

  /**
   * Build a standalone SVG chart string.
   * type: bar | column | line | area | pie | donut | scatter
   */
  function chart(opts) {
    var type = opts.type || "bar";
    var ds = opts.data;
    var title = opts.title || "";
    var W = opts.width || 720;
    var H = opts.height || 440;
    var dark = !!opts.dark;

    var fg = dark ? "#F5F4EF" : "#141413";
    var muted = dark ? "#A3A29C" : "#73726C";
    var grid = dark ? "#3E3E3B" : "#E3E1D9";
    var bg = dark ? "#30302E" : "#FFFFFF";
    var font = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

    var s = [];
    s.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '" font-family="' + font + '" role="img" aria-label="' + esc(title || "Chart") + '">');
    s.push(svgEl("rect", { x: 0, y: 0, width: W, height: H, fill: bg }));

    var top = title ? 52 : 24;
    if (title) {
      s.push('<text x="' + (W / 2) + '" y="32" text-anchor="middle" font-size="17" font-weight="600" fill="' + fg + '">' + esc(title) + "</text>");
    }

    var multi = ds.series.length > 1;
    var legendH = multi ? 30 : 0;

    /* ---- Pie / donut ---- */
    if (type === "pie" || type === "donut") {
      var vals = ds.series[0].values;
      var total = vals.reduce(function (a, b) { return a + Math.abs(b); }, 0) || 1;
      var cx = W * 0.36, cy = top + (H - top - 20) / 2;
      var R = Math.min(W * 0.3, (H - top - 40) / 2);
      var inner = type === "donut" ? R * 0.58 : 0;
      var ang = -Math.PI / 2;

      vals.forEach(function (v, idx) {
        var frac = Math.abs(v) / total;
        var sweep = frac * Math.PI * 2;
        var end = ang + sweep;
        var large = sweep > Math.PI ? 1 : 0;
        var x1 = cx + R * Math.cos(ang), y1 = cy + R * Math.sin(ang);
        var x2 = cx + R * Math.cos(end), y2 = cy + R * Math.sin(end);
        var col = PALETTE[idx % PALETTE.length];
        var d;
        if (inner) {
          var i1x = cx + inner * Math.cos(end), i1y = cy + inner * Math.sin(end);
          var i2x = cx + inner * Math.cos(ang), i2y = cy + inner * Math.sin(ang);
          d = "M" + x1 + "," + y1 + "A" + R + "," + R + " 0 " + large + " 1 " + x2 + "," + y2 +
              "L" + i1x + "," + i1y + "A" + inner + "," + inner + " 0 " + large + " 0 " + i2x + "," + i2y + "Z";
        } else {
          d = "M" + cx + "," + cy + "L" + x1 + "," + y1 + "A" + R + "," + R + " 0 " + large + " 1 " + x2 + "," + y2 + "Z";
        }
        s.push('<path d="' + d + '" fill="' + col + '" stroke="' + bg + '" stroke-width="2"><title>' +
               esc(ds.labels[idx] + ": " + v) + "</title></path>");

        if (frac > 0.045) {
          var mid = ang + sweep / 2, lr = inner ? (R + inner) / 2 : R * 0.66;
          s.push('<text x="' + (cx + lr * Math.cos(mid)).toFixed(1) + '" y="' + (cy + lr * Math.sin(mid) + 4).toFixed(1) +
                 '" text-anchor="middle" font-size="12" font-weight="600" fill="#fff">' +
                 (frac * 100).toFixed(0) + "%</text>");
        }
        ang = end;
      });

      if (type === "donut") {
        s.push('<text x="' + cx + '" y="' + (cy - 2) + '" text-anchor="middle" font-size="21" font-weight="700" fill="' + fg + '">' + esc(fmtNum(total)) + "</text>");
        s.push('<text x="' + cx + '" y="' + (cy + 17) + '" text-anchor="middle" font-size="11" fill="' + muted + '">Total</text>');
      }

      var lx = W * 0.68, ly = top + 6;
      ds.labels.forEach(function (lb, idx) {
        if (ly > H - 18) return;
        s.push(svgEl("rect", { x: lx, y: ly - 9, width: 11, height: 11, rx: 3, fill: PALETTE[idx % PALETTE.length] }));
        var pct = ((Math.abs(vals[idx]) / total) * 100).toFixed(1);
        s.push('<text x="' + (lx + 18) + '" y="' + ly + '" font-size="12" fill="' + fg + '">' +
               esc(String(lb).slice(0, 20)) + '</text>');
        s.push('<text x="' + (lx + 18) + '" y="' + (ly + 14) + '" font-size="10.5" fill="' + muted + '">' +
               fmtNum(vals[idx]) + " · " + pct + "%</text>");
        ly += 34;
      });

      s.push("</svg>");
      return s.join("");
    }

    /* ---- Cartesian charts ---- */
    var horizontal = type === "bar";
    var padL = horizontal ? Math.min(170, 46 + Math.max.apply(null, ds.labels.map(function (l) { return String(l).length; })) * 6.4) : 62;
    var padR = 24, padB = 52 + legendH, padT = top;
    var plotW = W - padL - padR;
    var plotH = H - padT - padB;

    var all = [];
    ds.series.forEach(function (se) { all = all.concat(se.values); });
    var maxV = Math.max.apply(null, all);
    var minV = Math.min.apply(null, all);
    if (type !== "scatter") { minV = Math.min(0, minV); }
    if (maxV === minV) maxV = minV + 1;
    var step = niceStep(maxV - minV, 5);
    var lo = Math.floor(minV / step) * step;
    var hi = Math.ceil(maxV / step) * step;
    var span = hi - lo || 1;

    var vx = function (v) { return padL + ((v - lo) / span) * plotW; };
    var vy = function (v) { return padT + plotH - ((v - lo) / span) * plotH; };

    // Gridlines and value axis
    for (var g = lo; g <= hi + 1e-9; g += step) {
      if (horizontal) {
        var gx = vx(g);
        s.push(svgEl("line", { x1: gx, y1: padT, x2: gx, y2: padT + plotH, stroke: grid, "stroke-width": 1 }));
        s.push('<text x="' + gx.toFixed(1) + '" y="' + (padT + plotH + 18) + '" text-anchor="middle" font-size="11" fill="' + muted + '">' + fmtNum(g) + "</text>");
      } else {
        var gy = vy(g);
        s.push(svgEl("line", { x1: padL, y1: gy, x2: padL + plotW, y2: gy, stroke: grid, "stroke-width": 1 }));
        s.push('<text x="' + (padL - 9) + '" y="' + (gy + 4).toFixed(1) + '" text-anchor="end" font-size="11" fill="' + muted + '">' + fmtNum(g) + "</text>");
      }
    }

    var n = ds.labels.length;
    var slotSize = (horizontal ? plotH : plotW) / Math.max(1, n);

    // Category labels
    ds.labels.forEach(function (lb, idx) {
      var txt = String(lb);
      var centre = (horizontal ? padT : padL) + slotSize * (idx + 0.5);
      if (horizontal) {
        s.push('<text x="' + (padL - 9) + '" y="' + (centre + 4).toFixed(1) + '" text-anchor="end" font-size="11.5" fill="' + fg + '">' + esc(txt.slice(0, 24)) + "</text>");
      } else {
        var skip = Math.ceil(n / Math.max(1, Math.floor(plotW / 58)));
        if (idx % skip !== 0) return;
        var rot = txt.length > 8 && n > 6;
        if (rot) {
          s.push('<text transform="translate(' + centre.toFixed(1) + "," + (padT + plotH + 16) + ') rotate(-38)" text-anchor="end" font-size="11" fill="' + fg + '">' + esc(txt.slice(0, 16)) + "</text>");
        } else {
          s.push('<text x="' + centre.toFixed(1) + '" y="' + (padT + plotH + 19) + '" text-anchor="middle" font-size="11.5" fill="' + fg + '">' + esc(txt.slice(0, 14)) + "</text>");
        }
      }
    });

    // Axis lines
    s.push(svgEl("line", { x1: padL, y1: padT, x2: padL, y2: padT + plotH, stroke: grid, "stroke-width": 1.5 }));
    s.push(svgEl("line", { x1: padL, y1: padT + plotH, x2: padL + plotW, y2: padT + plotH, stroke: grid, "stroke-width": 1.5 }));

    var sc = ds.series.length;

    ds.series.forEach(function (se, si) {
      var col = PALETTE[si % PALETTE.length];

      if (type === "bar" || type === "column") {
        var gap = slotSize * 0.22;
        var thick = (slotSize - gap) / sc;
        se.values.forEach(function (v, idx) {
          var start = (horizontal ? padT : padL) + slotSize * idx + gap / 2 + thick * si;
          if (horizontal) {
            var x0 = vx(Math.min(0, v)), x1b = vx(Math.max(0, v));
            s.push('<rect x="' + x0.toFixed(1) + '" y="' + start.toFixed(1) + '" width="' + Math.max(1, x1b - x0).toFixed(1) +
                   '" height="' + Math.max(1, thick - 2).toFixed(1) + '" rx="3" fill="' + col + '"><title>' +
                   esc(ds.labels[idx] + " · " + se.name + ": " + v) + "</title></rect>");
          } else {
            var y0 = vy(Math.max(0, v)), y1b = vy(Math.min(0, v));
            s.push('<rect x="' + start.toFixed(1) + '" y="' + y0.toFixed(1) + '" width="' + Math.max(1, thick - 2).toFixed(1) +
                   '" height="' + Math.max(1, y1b - y0).toFixed(1) + '" rx="3" fill="' + col + '"><title>' +
                   esc(ds.labels[idx] + " · " + se.name + ": " + v) + "</title></rect>");
          }
        });
      } else if (type === "line" || type === "area") {
        var pts = se.values.map(function (v, idx) {
          return [padL + slotSize * (idx + 0.5), vy(v)];
        });
        var dPath = pts.map(function (p, idx) { return (idx ? "L" : "M") + p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" ");
        if (type === "area") {
          s.push('<path d="' + dPath + " L" + pts[pts.length - 1][0].toFixed(1) + "," + vy(lo < 0 ? 0 : lo).toFixed(1) +
                 " L" + pts[0][0].toFixed(1) + "," + vy(lo < 0 ? 0 : lo).toFixed(1) + ' Z" fill="' + col + '" opacity="0.16"/>');
        }
        s.push('<path d="' + dPath + '" fill="none" stroke="' + col + '" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>');
        pts.forEach(function (p, idx) {
          s.push('<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3.6" fill="' + bg + '" stroke="' + col + '" stroke-width="2.2"><title>' +
                 esc(ds.labels[idx] + " · " + se.name + ": " + se.values[idx]) + "</title></circle>");
        });
      } else if (type === "scatter") {
        se.values.forEach(function (v, idx) {
          s.push('<circle cx="' + (padL + slotSize * (idx + 0.5)).toFixed(1) + '" cy="' + vy(v).toFixed(1) +
                 '" r="5.5" fill="' + col + '" opacity="0.78"><title>' +
                 esc(ds.labels[idx] + " · " + se.name + ": " + v) + "</title></circle>");
        });
      }
    });

    // Legend
    if (multi) {
      var lgx = padL, lgy = H - 14;
      ds.series.forEach(function (se, si) {
        s.push(svgEl("rect", { x: lgx, y: lgy - 9, width: 11, height: 11, rx: 3, fill: PALETTE[si % PALETTE.length] }));
        s.push('<text x="' + (lgx + 17) + '" y="' + lgy + '" font-size="12" fill="' + fg + '">' + esc(se.name) + "</text>");
        lgx += 30 + String(se.name).length * 7;
      });
    }

    s.push("</svg>");
    return s.join("");
  }

  /* ----------------------------------------------------- URL from any paste */

  /**
   * Pull the agent's address out of whatever the user pasted.
   *
   * Copilot Studio hands people a whole HTML document on the Channels page,
   * so that is what gets pasted far more often than a bare URL. Rather than
   * rejecting it, dig the src out. Handles, in order of preference:
   *   - a full <iframe src="..."> document or snippet
   *   - any src="..." or href="..." attribute
   *   - a bare https:// URL sitting in surrounding prose
   * Returns "" when there is no URL to find, so callers can fall back to
   * their own validation message.
   */
  function extractUrl(raw) {
    var text = String(raw || "").trim();
    if (!text) return "";

    // Already a clean single URL: leave it exactly as it is.
    if (/^https:\/\/\S+$/i.test(text)) return text;

    // Entities survive copy/paste from rendered pages, so &amp; must go back
    // to & or the query string breaks.
    function decode(s) {
      return s.replace(/&amp;/gi, "&").replace(/&#38;/g, "&")
              .replace(/&quot;/gi, '"').replace(/&#39;/g, "'")
              .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");
    }

    var m = text.match(/<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i);
    if (!m) m = text.match(/\b(?:src|href)\s*=\s*["']([^"']+)["']/i);
    if (m) {
      var attr = decode(m[1]).trim();
      if (/^https:\/\//i.test(attr)) return attr;
    }

    // Bare URL in prose. Stop at whitespace, quotes, angle brackets, and at
    // trailing sentence punctuation that is almost never part of a URL.
    m = text.match(/https:\/\/[^\s"'<>)\]]+/i);
    if (m) return decode(m[0]).replace(/[.,;:]+$/, "");

    return "";
  }

  /* --------------------------------------------------------------- exports */

  function download(filename, content, mime) {
    var blob = content instanceof Blob ? content : new Blob([content], { type: mime || "text/plain;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
    return filename;
  }

  /** Wrap rendered HTML in a portable, self-styled document. */
  function standaloneHTML(title, bodyHTML) {
    return '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
      "<title>" + esc(title) + "</title>\n<style>\n" +
      "  :root{--clay:#C96442;--ink:#141413;--muted:#73726C;--line:#E3E1D9;--wash:#F4E7E1}\n" +
      "  body{margin:0;padding:48px 24px;background:#F0EEE6;color:var(--ink);" +
      "font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;line-height:1.65}\n" +
      "  main{max-width:760px;margin:0 auto;background:#fff;padding:52px 56px;border-radius:16px;" +
      "border:1px solid var(--line);box-shadow:0 1px 3px rgba(0,0,0,.05)}\n" +
      "  h1,h2,h3,h4{font-family:ui-serif,Georgia,serif;line-height:1.25;letter-spacing:-.015em;margin:1.5em 0 .5em}\n" +
      "  main>:first-child{margin-top:0}\n  h1{font-size:2em}h2{font-size:1.5em}h3{font-size:1.2em}\n" +
      "  p{margin:0 0 1em}\n  ul,ol{padding-left:1.4em}li{margin-bottom:.35em}li::marker{color:var(--clay)}\n" +
      "  blockquote{margin:0 0 1em;padding:.2em 0 .2em 1em;border-left:3px solid var(--clay);color:var(--muted);font-style:italic}\n" +
      "  code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.875em;background:var(--wash);" +
      "color:#8C3F26;padding:.14em .4em;border-radius:5px}\n" +
      "  pre{background:#1B1B19;color:#F5F4EF;padding:16px;border-radius:12px;overflow-x:auto;font-size:13px}\n" +
      "  pre code{background:none;color:inherit;padding:0}\n" +
      "  table{width:100%;border-collapse:collapse;margin:0 0 1em;font-size:.95em}\n" +
      "  th,td{border:1px solid var(--line);padding:8px 12px;text-align:left}\n" +
      "  th{background:var(--wash);color:#8C3F26}\n  img,svg{max-width:100%;height:auto}\n" +
      "  hr{border:0;border-top:1px solid var(--line);margin:2em 0}\n" +
      "  footer{max-width:760px;margin:20px auto 0;color:var(--muted);font-size:12px;text-align:center}\n" +
      "  .tok-key{color:#C792EA}.tok-str{color:#C3E88D}.tok-num{color:#F78C6C}.tok-com{color:#7E8AA0;font-style:italic}\n" +
      "  @media print{body{background:#fff;padding:0}main{border:0;box-shadow:none;padding:0}}\n" +
      "</style>\n</head>\n<body>\n<main>\n" + bodyHTML +
      "\n</main>\n<footer>Generated " + new Date().toLocaleString() +
      " · BIG A workspace</footer>\n</body>\n</html>";
  }

  /** Convert an SVG string to a PNG blob via an offscreen canvas. */
  function svgToPng(svg, scale, cb) {
    var m = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
    var w = m ? parseFloat(m[1]) : 720;
    var h = m ? parseFloat(m[2]) : 440;
    var k = scale || 2;
    var img = new Image();
    var url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));

    img.onload = function () {
      var canvas = document.createElement("canvas");
      canvas.width = w * k;
      canvas.height = h * k;
      var ctx = canvas.getContext("2d");
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob(function (blob) { cb(null, blob); }, "image/png");
    };
    img.onerror = function () { URL.revokeObjectURL(url); cb(new Error("Could not rasterise the chart.")); };
    img.src = url;
  }

  /** Serialise a parsed dataset back to CSV. */
  function datasetToCSV(ds) {
    var q = function (v) { return /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v); };
    var out = [["Label"].concat(ds.series.map(function (s) { return s.name; })).map(q).join(",")];
    ds.labels.forEach(function (lb, i) {
      out.push([lb].concat(ds.series.map(function (s) { return s.values[i]; })).map(q).join(","));
    });
    return out.join("\n");
  }

  /* --------------------------------------------------------- agent avatars */

  /* Six tints drawn from the app's own palette, so an avatar never introduces
     a colour the rest of the interface does not already use. */
  var AVATAR_TINTS = [
    { bg: "#C96442", fg: "#FFFFFF" },
    { bg: "#3F8F5F", fg: "#FFFFFF" },
    { bg: "#4A6FA5", fg: "#FFFFFF" },
    { bg: "#8A6318", fg: "#FFFFFF" },
    { bg: "#7A5AA6", fg: "#FFFFFF" },
    { bg: "#2F7E86", fg: "#FFFFFF" }
  ];

  /**
   * A stable tint for a name. The same agent must keep the same colour across
   * reloads and between the sidebar, the top bar and every message, so this
   * hashes the name rather than storing or randomising anything.
   */
  function avatarTint(name) {
    var s = String(name || "");
    var h = 0;
    for (var i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return AVATAR_TINTS[Math.abs(h) % AVATAR_TINTS.length];
  }

  /**
   * Up to two initials for a name: "HR Assistant" gives "HA", "Chatgpt" gives
   * "C". Falls back to a dot rather than an empty circle.
   *
   * Uses Array.from so a name starting with an emoji or a non-BMP character
   * yields that whole character instead of half a surrogate pair.
   */
  function initials(name) {
    var words = String(name || "").trim().split(/[\s._-]+/).filter(Boolean);
    if (!words.length) return "\u00b7";
    var first = Array.from(words[0])[0] || "";
    var second = words.length > 1 ? (Array.from(words[1])[0] || "") : "";
    return (first + second).toUpperCase();
  }

  /**
   * An avatar element for an agent. Returns a real node rather than a string
   * so callers never have to think about escaping a user-supplied name.
   *
   * @param {{name?: string, icon?: string}} agent
   * @param {string} [size] "sm" | "md" | "lg"
   */
  function avatar(agent, size) {
    var name = (agent && agent.name) || "Agent";
    var el = document.createElement("span");
    el.className = "avatar" + (size ? " avatar-" + size : "");
    el.setAttribute("aria-hidden", "true");

    // A custom image wins when the agent has one; otherwise initials.
    if (agent && agent.icon) {
      var img = document.createElement("img");
      img.src = agent.icon;
      img.alt = "";
      // A broken or blocked image would otherwise leave a torn-page glyph.
      img.addEventListener("error", function () {
        el.removeChild(img);
        el.textContent = initials(name);
      });
      el.appendChild(img);
    } else {
      el.textContent = initials(name);
    }

    var tint = avatarTint(name);
    el.style.background = tint.bg;
    el.style.color = tint.fg;
    el.title = name;
    return el;
  }

  /* ---------------------------------------------------------------- export */

  global.Artifacts = {
    esc: esc,
    slug: slug,
    avatar: avatar,
    avatarTint: avatarTint,
    initials: initials,
    extractUrl: extractUrl,
    stamp: stamp,
    markdown: markdown,
    highlight: highlight,
    parseDataset: parseDataset,
    parseDelimited: parseDelimited,
    datasetToCSV: datasetToCSV,
    chart: chart,
    download: download,
    standaloneHTML: standaloneHTML,
    svgToPng: svgToPng,
    PALETTE: PALETTE
  };
})(window);
