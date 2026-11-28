"use strict";

function studyDiagram(id) {
  const generated = window.ECG_SCHEMA_IMAGES[id];
  const source = generated && (window.ECG_PRIVATE_SCHEMAS?.[id] || generated.src);
  if (source && id !== "005") {
    const figure = el("figure", "", "study-figure");
    const img = el("img");
    img.src = source;
    img.alt = generated.alt;
    [img.width, img.height] = generated.size;
    img.addEventListener("error", () => { figure.hidden = true; }, { once:true });
    figure.append(img);
    return figure;
  }
  const labels = {
    "005": "V3のST低下とⅢのST上昇を同じ基準線から測る模式図",
    "024": "QRSのR波から逆行性P′までの位置を比較する模式図",
    "027": "R波の開始からS波の最深部までを測る模式図",
  };
  if (!labels[id]) return null;
  const figure = el("figure", "", id === "005" ? "study-figure ratio-figure" : "study-figure");
  const canvas = el("canvas");
  const width = 420;
  const height = id === "005" ? 140 : 83;
  canvas.width = width * 3;
  canvas.height = height * 3;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", labels[id]);
  const g = canvas.getContext("2d");
  g.scale(3, 3);

  function line(points, color = "#173541", thickness = 1.8) {
    g.strokeStyle = color;
    g.lineWidth = thickness;
    g.beginPath();
    points.forEach(([x,y], i) => i ? g.lineTo(x,y) : g.moveTo(x,y));
    g.stroke();
  }

  function trace(x, y, segments, thickness = 1.8) {
    g.strokeStyle = "#173541";
    g.lineWidth = thickness;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(x, y);
    segments.forEach((segment) => {
      if (segment.length === 2) g.lineTo(...segment);
      else g.bezierCurveTo(...segment);
    });
    g.stroke();
  }

  function label(value, x, y, fill = "#173541", size = 14) {
    g.font = "600 " + size + "px system-ui, sans-serif";
    g.fillStyle = fill;
    g.fillText(value, x, y);
  }

  function guide(x1, y1, x2, y2) {
    g.setLineDash([4, 3]);
    line([[x1,y1],[x2,y2]], "#829a9f", 1);
    g.setLineDash([]);
  }

  function arrow(x1, y1, x2, y2, color) {
    line([[x1,y1],[x2,y2]], color, 1.6);
    const angle = Math.atan2(y2-y1,x2-x1);
    const head = Math.min(5, Math.hypot(x2-x1,y2-y1)/3);
    const tip = (x,y,a) => line([
      [x-head*Math.cos(a-.55),y-head*Math.sin(a-.55)],
      [x,y],
      [x-head*Math.cos(a+.55),y-head*Math.sin(a+.55)],
    ], color, 1.7);
    tip(x2,y2,angle);
    tip(x1,y1,angle+Math.PI);
  }

  function dot(x,y,color) {
    g.fillStyle = color;
    g.beginPath();
    g.arc(x,y,2.5,0,2*Math.PI);
    g.fill();
  }

  figure.append(canvas);

  if (id === "005") {
    const examples = [
      { down:.5, up:2, ratio:"0.25", range:"0.5未満", sign:"＝" },
      { down:1.25, up:1.5, ratio:"0.83", range:"0.5〜1.2", sign:"≒" },
      { down:2, up:1, ratio:"2.00", range:"1.2超", sign:"＝" },
    ];
    const tabs = el("div", "", "diagram-tabs");
    tabs.setAttribute("aria-label", "測定位置と比の計算例");
    const measure = el("img");
    measure.alt = generated.alt;
    measure.src = source;
    [measure.width, measure.height] = generated.size;
    measure.addEventListener("error", () => { if (!measure.hidden) showRatio(1); }, { once:true });
    figure.prepend(measure);
    const options = ["測る位置", ...examples.map(({ range }) => range)]
      .map((title, index) => button(title, () => showRatio(index-1)));
    const formula = el("figcaption");
    const footer = el("div", "", "diagram-footer");
    tabs.append(...options);
    footer.append(formula, tabs);
    figure.append(footer);

    function showRatio(index) {
      options.forEach((option,i) => option.setAttribute("aria-pressed",String(index+1 === i)));
      measure.hidden = index !== -1;
      canvas.hidden = index === -1;
      if (index === -1) {
        formula.textContent = "破線＝基線";
        return;
      }
      const { down, up, ratio, range, sign } = examples[index];
      g.clearRect(0,0,width,height);
      const baseline = 66;
      const ratioLeads = [
        [9,"V3",baseline + down * 18,"#145eaa",down],
        [219,"Ⅲ",baseline - up * 18,"#a04532",up],
      ];
      for (const [x,name,st,color,value] of ratioLeads) {
        label(name, x+2, 21, "#173541", 17);
        guide(x,baseline,x+184,baseline);
        const s = Math.max(baseline + 11, st + 7);
        const t = Math.min(baseline-9, st-12);
        trace(x, baseline, [
          [x+16,baseline],
          [x+23,baseline,x+24,baseline-5,x+32,baseline-5],
          [x+38,baseline-5,x+39,baseline,x+45,baseline],
          [x+60,baseline],
          [x+64,baseline,x+65,baseline-24,x+69,baseline-24],
          [x+73,baseline-24,x+74,s,x+79,s],
          [x+82,s,x+84,st,x+91,st],
          [x+109,st],
          [x+126,st,x+133,t,x+143,t],
          [x+153,t,x+158,baseline,x+172,baseline], [x+184,baseline],
        ]);
        g.globalAlpha = .12;
        g.fillStyle = color;
        g.fillRect(x+91,Math.min(st,baseline),30,Math.abs(st-baseline));
        g.globalAlpha = 1;
        dot(x+91,st,color);
        arrow(x+105,baseline,x+105,st,color);
        label((name === "V3" ? "ST低下 " : "ST上昇 ") + value + " mm", x+58, 129, color, 15);
      }
      formula.textContent = down + " ÷ " + up + " " + sign + " " + ratio + "（" + range + "）";
      canvas.setAttribute("aria-label", labels[id] + "。低下 " + down + "、上昇 " + up + "、比 " + ratio + "。");
    }
    showRatio(-1);
  } else if (id === "024") {
    for (const [x,text,p] of [[5,"short RP′",90],[216,"long RP′",139]]) {
      label(text,x+1,14);
      trace(x+7,54,[[x+39,54],[x+42,54,x+43,29,x+46,29],[x+49,29,x+48,61,x+51,61],
        [x+54,61,x+54,54,x+57,54],[x+p-9,54],
        [x+p-5,54,x+p-4,62,x+p,62],[x+p+4,62,x+p+5,54,x+p+9,54],[x+191,54]]);
      guide(x+46,31,x+46,78);
      guide(x+p,61,x+p,80);
      arrow(x+46,75,x+p,75,"#006459");
      label("R",x+39,24,"#006459",12);
      label("P′",x+p-6,49,"#006459",12);
    }
  } else {
    trace(28,39,[[105,39],[118,39,123,13,135,13],[153,13,164,68,186,68],
      [198,68,202,39,217,39],[358,39]]);
    guide(105,19,105,61);
    guide(186,15,186,70);
    dot(105,39,"#006459");
    dot(186,68,"#006459");
    arrow(105,76,186,76,"#006459");
    label("R開始",32,20,"#006459");
    label("S最深部",208,69,"#006459");
    label("RS時間",258,25);
  }
  return figure;
}
