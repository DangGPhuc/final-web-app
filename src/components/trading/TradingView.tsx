'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '@/context/AppContext';
import {
  calculatePaperTradePnL,
  estimateLiquidation,
} from '@/lib/finance/calculations';
import type { MarketCandle, TradeDirection, TradeStatus } from '@/types';
import {
  ShieldAlert,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  RefreshCw,
  Sliders,
  DollarSign,
  Bookmark,
  Trash2,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from 'recharts';

export function TradingView() {
  const { paperTrades, savePaperTrade, deletePaperTrade } = useApp();

  // Instrument
  const [instrument, setInstrument] = useState<'BTC' | 'XAU'>('BTC');
  const [livePrice, setLivePrice] = useState<number>(65000);
  const [candles, setCandles] = useState<MarketCandle[]>([]);
  const [isLive, setIsLive] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);

  // Trade Inputs
  const [direction, setDirection] = useState<TradeDirection>('LONG');
  const [entryPrice, setEntryPrice] = useState<number>(65000);
  const [simulatedPrice, setSimulatedPrice] = useState<number>(65000);
  const [margin, setMargin] = useState<number>(1000);
  const [leverage, setLeverage] = useState<number>(10);
  const [stopLoss, setStopLoss] = useState<string>('');
  const [takeProfit, setTakeProfit] = useState<string>('');
  const [feePercent, setFeePercent] = useState<number>(0.05);

  // Fetch market data
  const fetchMarketData = async (inst: 'BTC' | 'XAU') => {
    setLoading(true);
    try {
      const res = await fetch(`/api/market?instrument=${inst}&days=30`);
      if (res.ok) {
        const data = await res.json();
        setLivePrice(data.currentPrice);
        setEntryPrice(data.currentPrice);
        setSimulatedPrice(data.currentPrice);
        setCandles(data.candles || []);
        setIsLive(data.isLive);
      }
    } catch {
      // Fallback
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMarketData(instrument);
  }, [instrument]);

  // Calculate simulated PnL
  const pnlResult = useMemo(() => {
    const sl = stopLoss ? parseFloat(stopLoss) : undefined;
    const tp = takeProfit ? parseFloat(takeProfit) : undefined;
    return calculatePaperTradePnL(
      direction,
      entryPrice,
      simulatedPrice,
      margin,
      leverage,
      feePercent,
      sl,
      tp
    );
  }, [direction, entryPrice, simulatedPrice, margin, leverage, feePercent, stopLoss, takeProfit]);

  // Transform candles for chart
  const chartData = useMemo(() => {
    if (!candles.length) return [];
    return candles.map(c => {
      const d = new Date(c.time);
      const dateStr = `${d.getDate()}/${d.getMonth() + 1}`;
      return {
        date: dateStr,
        price: c.close,
        open: c.open,
        high: c.high,
        low: c.low,
      };
    });
  }, [candles]);

  const handleSaveScenario = () => {
    savePaperTrade({
      instrument,
      direction,
      entryPrice,
      currentPrice: simulatedPrice,
      margin,
      leverage,
      stopLoss: stopLoss ? parseFloat(stopLoss) : undefined,
      takeProfit: takeProfit ? parseFloat(takeProfit) : undefined,
      feePercent,
      status: pnlResult.status,
    });
  };

  const isLiquidated = pnlResult.status === 'LIQUIDATED';
  const isProfit = pnlResult.unrealizedPnL > 0;

  return (
    <div className="space-y-6">
      {/* Header & Disclaimer */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-2xl sm:text-3xl text-[#f5f5f7]">Demo Trading</h1>
            <span className="text-[10px] font-mono uppercase bg-[#2e2e2e] text-[#00b3dd] px-2 py-0.5 rounded">
              Paper Trading Simulator
            </span>
          </div>
          <p className="text-xs text-[#9f9fa0] mt-1">
            Môi trường mô phỏng vị thế phái sinh cô lập hoàn toàn — không kết nối sàn và không đặt lệnh thật
          </p>
        </div>

        {/* Instrument Selector */}
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-[#17181a] p-1 rounded-xl border border-[#232427]">
            <button
              onClick={() => setInstrument('BTC')}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-colors ${
                instrument === 'BTC'
                  ? 'bg-[#ffffff] text-[#000000] font-semibold'
                  : 'text-[#9f9fa0] hover:text-[#f5f5f7]'
              }`}
            >
              BTC / USD
            </button>
            <button
              onClick={() => setInstrument('XAU')}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-colors ${
                instrument === 'XAU'
                  ? 'bg-[#ffffff] text-[#000000] font-semibold'
                  : 'text-[#9f9fa0] hover:text-[#f5f5f7]'
              }`}
            >
              GOLD (XAU / USD)
            </button>
          </div>

          <button
            onClick={() => fetchMarketData(instrument)}
            className="p-2 rounded-xl bg-[#17181a] border border-[#232427] hover:border-[#34363a] text-[#9f9fa0] hover:text-[#ffffff]"
            title="Làm mới giá thị trường"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Strict Legal / Safety Disclaimer Banner */}
      <div className="p-4 rounded-xl bg-[#17181a] border border-[#232427] flex items-start gap-3">
        <ShieldAlert className="w-5 h-5 text-[#f59e0b] flex-shrink-0 mt-0.5" />
        <div className="text-xs text-[#9f9fa0] space-y-1">
          <div className="text-[#f5f5f7] font-medium">
            MÔ PHỎNG GIẢ LẬP — KHÔNG PHẢI TÀI KHOẢN GIAO DỊCH THẬT
          </div>
          <div>
            Trang này chỉ đọc dữ liệu thị trường công khai và thực hiện các phép tính toán học lý thuyết.
            Mọi thông số PnL, ROI và điểm thanh lý (Liquidation) chỉ mang tính minh họa, không phản ánh chính xác phí funding, trượt giá (slippage) hay quy tắc ký quỹ riêng của từng sàn giao dịch.
          </div>
          <div className="text-[11px] text-[#6b6b70] pt-1">
            Trạng thái nguồn dữ liệu:{' '}
            <span className={isLive ? 'text-[#10b981]' : 'text-[#f59e0b]'}>
              {isLive ? '● Live Market API (CoinGecko)' : '○ Dữ liệu mô phỏng nội bộ (Demo Fallback)'}
            </span>
          </div>
        </div>
      </div>

      {/* Main Trading Cockpit: Chart & Order Inputs */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Chart & Visual Levels */}
        <div className="lg:col-span-2 space-y-6">
          <div className="cockpit-card p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
              <div>
                <div className="text-xs text-[#9f9fa0] font-mono-data">
                  GIÁ THỊ TRƯỜNG HIỆN TẠI
                </div>
                <div className="text-2xl font-light text-[#f5f5f7] font-mono">
                  ${livePrice.toLocaleString()} <span className="text-xs text-[#9f9fa0]">USD</span>
                </div>
              </div>

              {/* Position Status Tag */}
              <div className="flex items-center gap-2">
                <span
                  className={`px-2.5 py-1 rounded-lg text-xs font-mono font-medium ${
                    isLiquidated
                      ? 'bg-[#f43f5e]/20 text-[#f43f5e] border border-[#f43f5e]/40'
                      : isProfit
                      ? 'bg-[#10b981]/20 text-[#10b981]'
                      : 'bg-[#2e2e2e] text-[#9f9fa0]'
                  }`}
                >
                  TRẠNG THÁI: {pnlResult.status}
                </span>
              </div>
            </div>

            {/* Price Chart */}
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#00b3dd" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#00b3dd" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#232427" vertical={false} />
                  <XAxis dataKey="date" stroke="#9f9fa0" fontSize={10} tickLine={false} />
                  <YAxis
                    stroke="#9f9fa0"
                    fontSize={10}
                    tickLine={false}
                    domain={['auto', 'auto']}
                    tickFormatter={val => `$${val.toLocaleString()}`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#17181a',
                      border: '1px solid #34363a',
                      borderRadius: '10px',
                      color: '#f5f5f7',
                      fontSize: '12px',
                    }}
                    formatter={(val: any) => [`$${Number(val).toLocaleString()}`, 'Giá']}
                  />
                  {/* Reference Lines */}
                  <ReferenceLine
                    y={entryPrice}
                    stroke="#ffffff"
                    strokeWidth={1.5}
                    label={{ value: 'Entry', fill: '#ffffff', fontSize: 10, position: 'right' }}
                  />
                  <ReferenceLine
                    y={simulatedPrice}
                    stroke="#00b3dd"
                    strokeDasharray="3 3"
                    label={{ value: 'Current', fill: '#00b3dd', fontSize: 10, position: 'right' }}
                  />
                  {pnlResult.estimatedLiquidationPrice && (
                    <ReferenceLine
                      y={pnlResult.estimatedLiquidationPrice}
                      stroke="#f43f5e"
                      strokeDasharray="4 4"
                      label={{ value: 'Liq Est.', fill: '#f43f5e', fontSize: 10, position: 'right' }}
                    />
                  )}
                  {stopLoss && (
                    <ReferenceLine
                      y={parseFloat(stopLoss)}
                      stroke="#f59e0b"
                      strokeDasharray="2 2"
                      label={{ value: 'SL', fill: '#f59e0b', fontSize: 10, position: 'left' }}
                    />
                  )}
                  {takeProfit && (
                    <ReferenceLine
                      y={parseFloat(takeProfit)}
                      stroke="#10b981"
                      strokeDasharray="2 2"
                      label={{ value: 'TP', fill: '#10b981', fontSize: 10, position: 'left' }}
                    />
                  )}
                  <Area
                    type="monotone"
                    dataKey="price"
                    stroke="#00b3dd"
                    strokeWidth={1.5}
                    fillOpacity={1}
                    fill="url(#colorPrice)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Simulated Price Slider */}
            <div className="mt-6 pt-4 border-t border-[#232427] space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[#9f9fa0] flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-[#00b3dd]" />
                  Mô phỏng biến động giá thị trường:
                </span>
                <span className="font-mono text-[#f5f5f7] font-medium">
                  ${simulatedPrice.toLocaleString()} ({pnlResult.priceMovePct >= 0 ? '+' : ''}
                  {pnlResult.priceMovePct}%)
                </span>
              </div>
              <input
                type="range"
                min={entryPrice * 0.5}
                max={entryPrice * 1.5}
                step={instrument === 'BTC' ? 50 : 1}
                value={simulatedPrice}
                onChange={e => setSimulatedPrice(parseFloat(e.target.value))}
                className="w-full accent-[#00b3dd]"
              />
            </div>
          </div>

          {/* Performance & Liquidation Metrics Box */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="cockpit-card p-4">
              <div className="text-[10px] text-[#9f9fa0] font-mono-data mb-1">
                LỢI NHUẬN / LỖ (PNL)
              </div>
              <div
                className={`text-lg font-mono font-medium ${
                  pnlResult.unrealizedPnL >= 0 ? 'text-[#10b981]' : 'text-[#f43f5e]'
                }`}
              >
                {pnlResult.unrealizedPnL >= 0 ? '+' : ''}${pnlResult.unrealizedPnL.toLocaleString()}
              </div>
              <div className="text-[10px] text-[#9f9fa0] mt-0.5">
                Đã trừ phí ({feePercent}%)
              </div>
            </div>

            <div className="cockpit-card p-4">
              <div className="text-[10px] text-[#9f9fa0] font-mono-data mb-1">
                TỶ SUẤT ROI VỐN
              </div>
              <div
                className={`text-lg font-mono font-medium ${
                  pnlResult.roi >= 0 ? 'text-[#10b981]' : 'text-[#f43f5e]'
                }`}
              >
                {pnlResult.roi >= 0 ? '+' : ''}{pnlResult.roi}%
              </div>
              <div className="text-[10px] text-[#9f9fa0] mt-0.5">
                Trên số margin ${margin}
              </div>
            </div>

            <div className="cockpit-card p-4">
              <div className="text-[10px] text-[#9f9fa0] font-mono-data mb-1">
                VỐN CÒN LẠI (EQUITY)
              </div>
              <div
                className={`text-lg font-mono font-medium ${
                  isLiquidated ? 'text-[#f43f5e]' : 'text-[#f5f5f7]'
                }`}
              >
                ${Math.max(0, pnlResult.remainingEquity).toLocaleString()}
              </div>
              <div className="text-[10px] text-[#9f9fa0] mt-0.5">
                Margin + PnL
              </div>
            </div>

            <div className="cockpit-card p-4">
              <div className="text-[10px] text-[#9f9fa0] font-mono-data mb-1">
                GIÁ THANH LÝ ƯỚC TÍNH
              </div>
              <div className="text-lg font-mono font-medium text-[#f43f5e]">
                {pnlResult.estimatedLiquidationPrice
                  ? `$${pnlResult.estimatedLiquidationPrice.toLocaleString()}`
                  : 'N/A (1x)'}
              </div>
              <div className="text-[10px] text-[#9f9fa0] mt-0.5">
                Khi vốn về 0 (Mô phỏng)
              </div>
            </div>
          </div>
        </div>

        {/* Right Col: Order Parameter Form */}
        <div className="cockpit-card p-6 space-y-4">
          <h2 className="text-sm font-medium text-[#f5f5f7]">Thiết lập vị thế giả lập</h2>

          {/* Direction Toggle */}
          <div>
            <label className="text-xs text-[#9f9fa0] block mb-1.5 font-mono-data">HƯỚNG LỆNH</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setDirection('LONG')}
                className={`py-2 rounded-lg text-xs font-mono font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                  direction === 'LONG'
                    ? 'bg-[#10b981] text-[#000000]'
                    : 'bg-[#17181a] border border-[#232427] text-[#9f9fa0]'
                }`}
              >
                <TrendingUp className="w-4 h-4" /> LONG (MUA)
              </button>
              <button
                type="button"
                onClick={() => setDirection('SHORT')}
                className={`py-2 rounded-lg text-xs font-mono font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                  direction === 'SHORT'
                    ? 'bg-[#f43f5e] text-[#ffffff]'
                    : 'bg-[#17181a] border border-[#232427] text-[#9f9fa0]'
                }`}
              >
                <TrendingDown className="w-4 h-4" /> SHORT (BÁN)
              </button>
            </div>
          </div>

          {/* Entry Price */}
          <div>
            <div className="flex items-center justify-between text-xs text-[#9f9fa0] mb-1">
              <span className="font-mono-data">GIÁ VÀO LỆNH (ENTRY)</span>
              <button
                type="button"
                onClick={() => {
                  setEntryPrice(livePrice);
                  setSimulatedPrice(livePrice);
                }}
                className="text-[10px] text-[#00b3dd] hover:underline"
              >
                Theo giá live
              </button>
            </div>
            <input
              type="number"
              value={entryPrice}
              onChange={e => {
                const val = parseFloat(e.target.value) || 0;
                setEntryPrice(val);
                setSimulatedPrice(val);
              }}
              className="cockpit-input w-full text-xs font-mono"
            />
          </div>

          {/* Margin (Tiền vốn) */}
          <div>
            <label className="text-xs text-[#9f9fa0] block mb-1 font-mono-data">
              TIỀN VỐN (MARGIN - USD)
            </label>
            <input
              type="number"
              step={100}
              value={margin}
              onChange={e => setMargin(parseFloat(e.target.value) || 0)}
              className="cockpit-input w-full text-xs font-mono"
            />
          </div>

          {/* Leverage Slider & Input */}
          <div>
            <div className="flex items-center justify-between text-xs text-[#9f9fa0] mb-1">
              <span className="font-mono-data">ĐÒN BẨY (LEVERAGE)</span>
              <span className="font-mono font-semibold text-[#f5f5f7]">{leverage}x</span>
            </div>
            <input
              type="range"
              min={1}
              max={50}
              step={1}
              value={leverage}
              onChange={e => setLeverage(parseInt(e.target.value, 10))}
              className="w-full accent-[#ffffff]"
            />
            <div className="flex justify-between text-[10px] text-[#9f9fa0] font-mono mt-1">
              <span>1x</span>
              <span>10x</span>
              <span>25x</span>
              <span>50x</span>
            </div>
          </div>

          {/* Position Size Summary */}
          <div className="p-3 rounded-lg bg-[#090a0b] border border-[#232427]">
            <div className="text-[10px] text-[#9f9fa0] font-mono-data">QUY MÔ VỊ THẾ (POSITION SIZE)</div>
            <div className="text-sm font-mono font-semibold text-[#f5f5f7] mt-0.5">
              ${(margin * leverage).toLocaleString()} USD
            </div>
            <div className="text-[10px] text-[#9f9fa0]">
              = Vốn (${margin}) × Đòn bẩy ({leverage}x)
            </div>
          </div>

          {/* Optional Stop Loss & Take Profit */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] text-[#9f9fa0] block mb-1 font-mono-data">
                STOP LOSS (SL)
              </label>
              <input
                type="number"
                placeholder="Tùy chọn"
                value={stopLoss}
                onChange={e => setStopLoss(e.target.value)}
                className="cockpit-input w-full text-xs font-mono"
              />
            </div>
            <div>
              <label className="text-[11px] text-[#9f9fa0] block mb-1 font-mono-data">
                TAKE PROFIT (TP)
              </label>
              <input
                type="number"
                placeholder="Tùy chọn"
                value={takeProfit}
                onChange={e => setTakeProfit(e.target.value)}
                className="cockpit-input w-full text-xs font-mono"
              />
            </div>
          </div>

          {/* Action: Save Scenario */}
          <button
            onClick={handleSaveScenario}
            className="btn-primary w-full text-xs flex items-center justify-center gap-1.5 mt-2"
          >
            <Bookmark className="w-3.5 h-3.5" />
            <span>Lưu kịch bản mô phỏng này</span>
          </button>
        </div>
      </div>

      {/* Saved Paper Trade Scenarios List */}
      {paperTrades.length > 0 && (
        <div className="cockpit-card p-6">
          <h3 className="text-sm font-medium text-[#f5f5f7] mb-3">
            Các kịch bản mô phỏng đã lưu ({paperTrades.length})
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[#232427] text-[#9f9fa0] font-mono-data">
                  <th className="pb-3 pr-4">TÀI SẢN</th>
                  <th className="pb-3 pr-4">HƯỚNG</th>
                  <th className="pb-3 pr-4 font-mono">VỐN & ĐÒN BẨY</th>
                  <th className="pb-3 pr-4 font-mono">ENTRY</th>
                  <th className="pb-3 pr-4 font-mono">GIÁ MÔ PHỎNG</th>
                  <th className="pb-3 pr-4 text-center">TRẠNG THÁI</th>
                  <th className="pb-3 text-right">THAO TÁC</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#232427]">
                {paperTrades.map(trade => (
                  <tr key={trade.id} className="hover:bg-[#1f2022]/40">
                    <td className="py-3 pr-4 font-mono font-medium text-[#f5f5f7]">
                      {trade.instrument}
                    </td>
                    <td className="py-3 pr-4">
                      <span
                        className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${
                          trade.direction === 'LONG'
                            ? 'bg-[#10b981]/10 text-[#10b981]'
                            : 'bg-[#f43f5e]/10 text-[#f43f5e]'
                        }`}
                      >
                        {trade.direction}
                      </span>
                    </td>
                    <td className="py-3 pr-4 font-mono text-[#9f9fa0]">
                      ${trade.margin} ({trade.leverage}x)
                    </td>
                    <td className="py-3 pr-4 font-mono text-[#f5f5f7]">
                      ${trade.entryPrice.toLocaleString()}
                    </td>
                    <td className="py-3 pr-4 font-mono text-[#00b3dd]">
                      ${trade.currentPrice.toLocaleString()}
                    </td>
                    <td className="py-3 pr-4 text-center font-mono">
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded ${
                          trade.status === 'PROFIT'
                            ? 'bg-[#10b981]/20 text-[#10b981]'
                            : trade.status === 'LOSS'
                            ? 'bg-[#f43f5e]/20 text-[#f43f5e]'
                            : trade.status === 'LIQUIDATED'
                            ? 'bg-[#f43f5e] text-[#ffffff]'
                            : 'bg-[#2e2e2e] text-[#9f9fa0]'
                        }`}
                      >
                        {trade.status}
                      </span>
                    </td>
                    <td className="py-3 text-right">
                      <button
                        onClick={() => deletePaperTrade(trade.id)}
                        className="p-1 rounded hover:bg-[#f43f5e]/10 text-[#9f9fa0] hover:text-[#f43f5e]"
                        title="Xóa kịch bản"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
