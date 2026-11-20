// AUTHORED-BY Claude Opus 5.5
// A small Markdown renderer for the Specifications view. No dependency. All text is escaped.
// Supports: ATX headings with ids, paragraphs, bold, italic, inline code, links, autolinks,
// ordered/unordered/nested lists, fenced code, tables, blockquotes, horizontal rules.
// Requirement keywords (MUST, MUST NOT, SHOULD, SHOULD NOT, MAY, ...) get class "kw".
(function () {
  'use strict';
  var AX = (window.AX = window.AX || {});

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function slug(text) {
    return text.toLowerCase().replace(/<[^>]+>/g, '').replace(/&[a-z#0-9]+;/g, '').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-') || 'section';
  }
  var KW = /\b(MUST NOT|MUST|SHALL NOT|SHALL|SHOULD NOT|SHOULD|NOT RECOMMENDED|RECOMMENDED|REQUIRED|MAY|OPTIONAL)\b/g;

  // opts.link(href) may rewrite hrefs (for links between spec documents).
  function inline(src, opts) {
    var slots = [];
    function hold(html) { slots.push(html); return '\u0000' + (slots.length - 1) + '\u0000'; }
    var s = src;
    // Code spans.
    s = s.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, function (_, t, code) { return hold('<code>' + esc(code.trim()) + '</code>'); });
    // Autolinks <https://...>.
    s = s.replace(/<(https?:\/\/[^\s>]+)>/g, function (_, u) { return hold('<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(u) + '</a>'); });
    // Links [text](href "title").
    s = s.replace(/\[([^\]]+)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g, function (_, text, href) {
      if (/^\s*javascript:/i.test(href)) return hold(inline(text, opts));
      var h = opts && opts.link ? opts.link(href) : href;
      var ext = /^https?:/i.test(h);
      return hold('<a href="' + esc(h) + '"' + (ext ? ' target="_blank" rel="noopener"' : '') + '>' + inline(text, opts) + '</a>');
    });
    s = esc(s);
    s = s.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+?)__/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<em>$2</em>').replace(/(^|[^_\w])_([^_\s][^_]*?)_(?![_\w])/g, '$1<em>$2</em>');
    s = s.replace(KW, '<span class="kw">$1</span>');
    s = s.replace(/ {2,}\n/g, '<br>').replace(/\n/g, ' ');
    // Restore held spans (they may nest).
    for (var guard = 0; guard < 5 && /\u0000\d+\u0000/.test(s); guard++) {
      s = s.replace(/\u0000(\d+)\u0000/g, function (_, n) { return slots[+n]; });
    }
    return s;
  }

  var RE = {
    fence: /^(\s*)(`{3,}|~{3,})\s*([\w+-]*)\s*$/,
    heading: /^(#{1,6})\s+(.*?)\s*#*\s*$/,
    hr: /^\s{0,3}([-*_])(\s*\1){2,}\s*$/,
    quote: /^\s{0,3}>\s?/,
    item: /^(\s*)([-*+]|\d+[.)])\s+(.*)$/,
    tableSep: /^(?=.*\|)\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/,
  };
  function splitRow(line) {
    var l = line.trim().replace(/^\|/, '').replace(/\|$/, '');
    var cells = [];
    var cur = '';
    for (var i = 0; i < l.length; i++) {
      if (l[i] === '\\' && l[i + 1] === '|') { cur += '|'; i++; continue; }
      if (l[i] === '|') { cells.push(cur.trim()); cur = ''; continue; }
      cur += l[i];
    }
    cells.push(cur.trim());
    return cells;
  }
  function isBlockStart(l) {
    return RE.fence.test(l) || RE.heading.test(l) || RE.hr.test(l) || RE.quote.test(l) || RE.item.test(l);
  }
  function indentOf(s) { var m = s.match(/^\s*/)[0]; return m.replace(/\t/g, '    ').length; }

  function blocks(lines, ctx) {
    var out = '';
    var i = 0;
    function startsBlock(l) {
      return RE.fence.test(l) || RE.heading.test(l) || RE.hr.test(l) || RE.quote.test(l) || RE.item.test(l);
    }
    while (i < lines.length) {
      var line = lines[i];
      if (!line.trim()) { i++; continue; }
      var m;
      if ((m = line.match(RE.fence))) {
        var marker = m[2];
        var lang = m[3];
        var code = [];
        i++;
        while (i < lines.length && lines[i].trim().indexOf(marker) !== 0) { code.push(lines[i]); i++; }
        i++;
        out += '<pre><code' + (lang ? ' data-lang="' + esc(lang) + '"' : '') + '>' + esc(code.join('\n')) + '</code></pre>';
        continue;
      }
      if ((m = line.match(RE.heading))) {
        var level = m[1].length;
        var html = inline(m[2], ctx.opts);
        var id = slug(m[2]);
        var base = id;
        var n = 2;
        while (ctx.ids[id]) id = base + '-' + n++;
        ctx.ids[id] = true;
        ctx.headings.push({ level: level, id: id, text: m[2] });
        out += '<h' + level + ' id="' + id + '">' + html + (ctx.opts.anchor ? '<a class="hl" href="' + esc(ctx.opts.anchor(id)) + '" aria-label="Link to this section">#</a>' : '') + '</h' + level + '>';
        i++;
        continue;
      }
      if (RE.hr.test(line)) { out += '<hr>'; i++; continue; }
      if (RE.quote.test(line)) {
        var q = [];
        while (i < lines.length && lines[i].trim() && (RE.quote.test(lines[i]) || !startsBlock(lines[i]))) { q.push(lines[i].replace(RE.quote, '')); i++; }
        out += '<blockquote>' + blocks(q, ctx) + '</blockquote>';
        continue;
      }
      if (line.indexOf('|') >= 0 && i + 1 < lines.length && RE.tableSep.test(lines[i + 1])) {
        var head = splitRow(line);
        var aligns = splitRow(lines[i + 1]).map(function (c) {
          return /^:-+:$/.test(c) ? 'center' : /-+:$/.test(c) ? 'right' : /^:-+/.test(c) ? 'left' : '';
        });
        i += 2;
        var t = '<table><thead><tr>' + head.map(function (c, k) { return '<th' + (aligns[k] ? ' style="text-align:' + aligns[k] + '"' : '') + '>' + inline(c, ctx.opts) + '</th>'; }).join('') + '</tr></thead><tbody>';
        while (i < lines.length && lines[i].trim() && lines[i].indexOf('|') >= 0) {
          var cells = splitRow(lines[i]);
          t += '<tr>' + head.map(function (_, k) { return '<td' + (aligns[k] ? ' style="text-align:' + aligns[k] + '"' : '') + '>' + inline(cells[k] || '', ctx.opts) + '</td>'; }).join('') + '</tr>';
          i++;
        }
        out += t + '</tbody></table>';
        continue;
      }
      if ((m = line.match(RE.item))) {
        var res = list(lines, i, ctx);
        out += res.html;
        i = res.next;
        continue;
      }
      // Paragraph.
      var para = [];
      while (i < lines.length && lines[i].trim() && !startsBlock(lines[i]) && !(lines[i].indexOf('|') >= 0 && i + 1 < lines.length && RE.tableSep.test(lines[i + 1]))) {
        para.push(lines[i].replace(/^\s+/, ''));
        i++;
      }
      if (!para.length) { para.push(lines[i]); i++; }
      out += '<p>' + inline(para.join('\n'), ctx.opts) + '</p>';
    }
    return out;
  }

  function list(lines, start, ctx) {
    var first = lines[start].match(RE.item);
    var baseIndent = indentOf(first[1]);
    var ordered = /\d/.test(first[2]);
    var startNum = ordered ? parseInt(first[2], 10) : 1;
    var items = [];
    var i = start;
    var loose = false;
    while (i < lines.length) {
      var line = lines[i];
      var m = line.match(RE.item);
      if (m && indentOf(m[1]) === baseIndent && /\d/.test(m[2]) === ordered) {
        var contentIndent = indentOf(m[1]) + m[2].length + 1;
        var body = [m[3]];
        i++;
        var sawBlank = false;
        while (i < lines.length) {
          var l = lines[i];
          if (!l.trim()) { sawBlank = true; body.push(''); i++; continue; }
          var ind = indentOf(l);
          var mm = l.match(RE.item);
          if (mm && indentOf(mm[1]) <= baseIndent) break; // a sibling or a parent item
          if (ind >= Math.min(contentIndent, baseIndent + 2)) {
            if (sawBlank && !mm) loose = true;
            body.push(l.slice(Math.min(ind, contentIndent)));
            sawBlank = false;
            i++;
            continue;
          }
          if (!sawBlank && !isBlockStart(l)) { body.push(l.trim()); i++; continue; } // lazy continuation
          break;
        }
        while (body.length && !body[body.length - 1].trim()) body.pop();
        items.push(body);
        continue;
      }
      if (!line.trim()) {
        // A blank line between items keeps the list going if another item follows.
        var j = i;
        while (j < lines.length && !lines[j].trim()) j++;
        var nm = j < lines.length && lines[j].match(RE.item);
        if (nm && indentOf(nm[1]) === baseIndent && /\d/.test(nm[2]) === ordered) { loose = true; i = j; continue; }
      }
      break;
    }
    var tag = ordered ? 'ol' : 'ul';
    var html = '<' + tag + (ordered && startNum !== 1 ? ' start="' + startNum + '"' : '') + '>';
    items.forEach(function (body) {
      var inner = blocks(body, ctx);
      if (!loose) inner = inner.replace(/^<p>([\s\S]*?)<\/p>/, '$1');
      html += '<li>' + inner + '</li>';
    });
    return { html: html + '</' + tag + '>', next: i };
  }

  // Render markdown to HTML. Returns { html, headings }.
  AX.markdown = function (src, opts) {
    var text = String(src || '').replace(/\r\n?/g, '\n').replace(/<!--[\s\S]*?-->/g, '');
    var ctx = { ids: {}, headings: [], opts: opts || {} };
    return { html: blocks(text.split('\n'), ctx), headings: ctx.headings };
  };
})();
