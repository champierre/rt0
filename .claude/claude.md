# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクトガイドライン

指示されたこと以外は機能を追加せず、最低限の実装だけにとどめること。

## アーキテクチャ

### デーモン・コマンド方式

rt0-cliはデーモンプロセスとコマンドプロセスの2つのモードで動作する:

1. **デーモンモード**: `node rt0-cli/cli.js` (引数なし)
   - iRobot Root robotにBLE接続し、接続を維持
   - Unix socketでIPCサーバーを起動 (`/tmp/rt0-cli/daemon.sock`)
   - コマンドプロセスからの要求を受けてロボットを制御
   - Ctrl-Cで切断して終了

2. **コマンドモード**: `node rt0-cli/cli.js <command> <args>`
   - Unix socket経由でデーモンプロセスにコマンドを送信
   - デーモンが実行結果を返したら終了

### BLE通信プロトコル

- Service UUID: `48c5d828ac2a442d97a30c9822b04979` (Root robot service)
- UART Service: `6e400001b5a3f393e0a9e50e24dcca9e`
- TX Characteristic: `6e400002b5a3f393e0a9e50e24dcca9e` (コマンド送信用)
- RX Characteristic: `6e400003b5a3f393e0a9e50e24dcca9e` (レスポンス受信用)

コマンドは19バイト固定長 + CRC8チェックサム(1バイト)の計20バイト:
- Byte 0: Device ID (1=Motors, 2=Marker/Eraser, 5=Sound)
- Byte 1: Command ID
- Byte 2: Packet ID
- Byte 3-18: Parameters
- Byte 19: CRC8 checksum

### ファイル構成

- `rt0-cli/cli.js`: エントリーポイント。引数の有無でデーモン/コマンドモードを切り替え
- `rt0-cli/commands/daemon.js`: デーモンプロセス実装。BLE接続とIPCサーバー
- `rt0-cli/commands/*.js`: 各コマンドの実装。IPCクライアントとしてデーモンに要求を送る
- `rt0-cli/lib/ipc.js`: Unix socketベースのIPC通信(server/client)
- `rt0-cli/lib/protocol.js`: Root robotプロトコル実装(CRC8計算、コマンドバイト列生成)
- `rt0-cli/lib/command-helper.js`: コマンド実装の共通処理

### コマンド応答の仕組み

1. コマンドをTX characteristicに送信
2. RX characteristicからの通知を待つ
3. レスポンスの最初の2バイト(Device ID + Command ID)でコマンドを識別
4. `commandResolvers` Map にキー `${deviceId}-${commandId}` でresolverを登録
5. 該当レスポンス受信時にresolverを呼び出してPromiseを解決

## 開発コマンド

```bash
# デーモン起動(別ターミナルで実行し続ける)
node rt0-cli/cli.js

# コマンド実行例
node rt0-cli/cli.js forward 100       # 100mm前進
node rt0-cli/cli.js rotate 90         # 90度回転
node rt0-cli/cli.js penUp             # ペンを上げる
node rt0-cli/cli.js penDown           # ペンを下げる
node rt0-cli/cli.js playNote 440 1000 # 440Hzの音を1000ms鳴らす

# 負の値を使う場合
node rt0-cli/cli.js forward -- -100   # 100mm後退
node rt0-cli/cli.js rotate -- -90     # 90度逆回転
```

## 使用技術

- Node.js ES modules
- @abandonware/noble: BLE通信ライブラリ
- commander: CLIフレームワーク
- net: Unix socket通信(IPC)
