const express = require('express');
const { spawn } = require('child_process');
const cors = require('cors');
const app = express();
const fs = require('fs');
const path = require('path');

// Configuração de cores para o terminal
const colors = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  

};

// Criar diretório de downloads se não existir
const downloadsDir = path.join(__dirname, 'downloads');
const playlistsDir = path.join(downloadsDir, 'playlists');

if (!fs.existsSync(downloadsDir)) {
  fs.mkdirSync(downloadsDir);
}

if (!fs.existsSync(playlistsDir)) {
  fs.mkdirSync(playlistsDir);
}

app.use(express.json());
app.use(cors());

// Função para mostrar progresso no terminal
function setupProgressLogger(process, isPlaylist = false) {
  let currentItem = 0;
  let totalItems = 0;
  const startTime = Date.now();
  let currentFileName = '';
  let lastOutput = '';

  process.stdout.on('data', (data) => {
    const output = data.toString();
    
    // Nome do arquivo sendo baixado
    const fileMatch = output.match(/\[download\] Destination: (.+)/);
    if (fileMatch) {
      currentFileName = path.basename(fileMatch[1]);
      console.log(`\n📄 Arquivo: ${currentFileName}`);
    }
    
    // Progresso do download
    const progressMatch = output.match(/\[download\]\s+(\d+\.\d)%/);
    const speedMatch = output.match(/at\s+([^\s]+)/);
    const etaMatch = output.match(/ETA\s+([^\s]+)/);
    
    if (progressMatch) {
      const progress = progressMatch[1];
      const speed = speedMatch ? speedMatch[1] : 'calculando...';
      const eta = etaMatch ? etaMatch[1] : 'calculando...';
      
      // Substitui a abordagem de clearLine por uma solução mais simples
      const newOutput = `↳ Progresso: ${progress}% | Velocidade: ${speed} | ETA: ${eta}`;
      if (newOutput !== lastOutput) {
        process.stdout.write('\r' + newOutput);
        lastOutput = newOutput;
      }
    }
  });

  process.stderr.on('data', (data) => {
    const output = data.toString();
    
    // Progresso de playlist
    const itemMatch = output.match(/\[download\] Downloading item (\d+) of (\d+)/);
    if (itemMatch && isPlaylist) {
      currentItem = parseInt(itemMatch[1]);
      totalItems = parseInt(itemMatch[2]);
      console.log(`\n📁 Baixando item ${currentItem} de ${totalItems}`);
    }
    
    // Conversão para áudio
    if (output.includes('[ExtractAudio]')) {
      console.log('\n🔊 Convertendo para áudio...');
    }
  });

  process.on('close', () => {
    console.log(`\n✅ Download concluído! (${((Date.now() - startTime)/1000).toFixed(1)} segundos)`);
  });
}

app.post('/download-playlist', async (req, res) => {
  try {
    const { url, formato } = req.body;

    if (!url) throw new Error('URL é obrigatória');
    if (!url.match(/youtube\.com|youtu\.be/)) throw new Error('URL do YouTube inválida');

    console.log(`\n▶️ Iniciando download de playlist: ${url}`);
    console.log(`ℹ️ Formato: ${formato === 'audio' ? 'Somente Áudio' : 'Vídeo + Áudio'}`);

    const args = [
      '--newline',
      '--progress',
      '--console-title',
      '-o', 'downloads/playlists/%(playlist_title)s/%(title)s.%(ext)s',
      '--embed-thumbnail',
      '--embed-metadata',
      '--yes-playlist',
      '--no-warnings',
      '--force-overwrites',
      '--no-continue'
    ];

    if (formato === 'audio') {
      args.push(
        '-x',
        '--audio-format', 'aac',
        '--postprocessor-args', 'ffmpeg:-c:a aac -b:a 192k'
      );
    } else {
      args.push(
        '-f', 'bestvideo+bestaudio',
        '--merge-output-format', 'mp4',
        '--audio-format', 'aac',
        '--force-keyframes-at-cuts',
        '--postprocessor-args', 'ffmpeg:-c:a aac -b:a 192k'
      );
    }

    args.push(url);

    const result = await new Promise((resolve, reject) => {
      const downloader = spawn('yt-dlp', args, {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      // Configurar listeners antes de iniciar o processo
      setupProgressLogger(downloader, true);

      let output = '';
      downloader.stdout.on('data', (data) => {
        output += data.toString();
      });

      downloader.on('close', (code) => {
        if (code !== 0) {
          return reject(new Error(`Download falhou com código ${code}`));
        }
        resolve(output);
      });

      downloader.on('error', (err) => reject(err));
    });

    res.json({ 
      success: true,
      message: 'Playlist baixada com sucesso!',
      details: result
    });
  } catch (error) {
    console.error('\n✖ Erro no download:', error.message);
    res.status(500).json({ 
      success: false,
      error: 'Falha no download da playlist',
      details: error.message
    });
  }
});

// Adicione estas cores adicionais no topo do arquivo
colors.magenta = '\x1b[35m';
colors.blue = '\x1b[34m';
colors.bold = '\x1b[1m';

function renderProgressBar(percent) {
  const width = 30;
  const filled = Math.round(width * percent / 100);
  const percentage = `${percent}%`.padStart(4);
  return `${colors.yellow}${'█'.repeat(filled)}${'░'.repeat(width - filled)} ${colors.cyan}${percentage}${colors.reset}`;
}

app.post('/get-formats', async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url) throw new Error('URL é obrigatória');
    if (!url.match(/youtube\.com|youtu\.be/)) throw new Error('URL do YouTube inválida');

    console.log(`${colors.cyan}ℹ️ Buscando formatos para: ${url}${colors.reset}`);

    const formats = await new Promise((resolve, reject) => {
      const ytDlp = spawn('yt-dlp', ['-F', url, '--no-warnings']);
      let output = '';
      let errorOutput = '';

      ytDlp.stdout.on('data', (data) => output += data.toString());
      ytDlp.stderr.on('data', (data) => errorOutput += data.toString());

      ytDlp.on('close', (code) => {
        if (code !== 0) {
          return reject(new Error(errorOutput || `yt-dlp exited with code ${code}`));
        }

        const lines = output.split('\n');
        const formats = [];

        for (const line of lines) {
          const match = line.match(/^(\d+)\s+(\w+)\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)\s*(.+)?/);
          if (match) {
            formats.push({
              format_id: match[1],
              extension: match[2],
              resolution: match[3] || '',
              fps: match[4] || '',
              channels: match[5] || '',
              filesize: match[6] || '',
              tbr: match[7] || '',
              codec: match[8] || '',
              full_info: line
            });
          }
        }

        if (formats.length === 0) {
          return reject(new Error('Nenhum formato encontrado'));
        }

        resolve(formats);
      });

      ytDlp.on('error', (err) => reject(err));
    });

    const processedFormats = processFormats(formats);

    console.log(`${colors.green}✔️ Formatos encontrados: ${processedFormats.length}${colors.reset}`);

    res.json({ formats: processedFormats });
  } catch (error) {
    console.error(`${colors.red}✖ Erro em /get-formats:${colors.reset}`, error);
    res.status(500).json({ 
      error: 'Falha ao obter formatos',
      details: error.message
    });
  }
});

function processFormats(formats) {
  const resolutionMap = {};

  const videoFormats = formats.filter(f => f.resolution && !f.channels.includes('audio'));

  videoFormats.forEach(format => {
    if (!resolutionMap[format.resolution]) {
      resolutionMap[format.resolution] = [];
    }
    resolutionMap[format.resolution].push(format);
  });

  const result = [];
  Object.keys(resolutionMap).forEach(res => {
    const formatsForRes = resolutionMap[res];
    
    const formatsWithSize = formatsForRes.map(f => {
      const sizeInBytes = convertToBytes(f.filesize);
      return { ...f, sizeInBytes };
    }).filter(f => !isNaN(f.sizeInBytes));

    if (formatsWithSize.length > 0) {
      formatsWithSize.sort((a, b) => a.sizeInBytes - b.sizeInBytes);
      
      const middleIndex = Math.floor(formatsWithSize.length / 2);
      result.push(formatsWithSize[middleIndex]);
    }
  });

  const audioFormats = formats.filter(f => f.channels.includes('audio'));
  if (audioFormats.length > 0) {
    audioFormats.sort((a, b) => {
      const aRate = parseInt(a.tbr) || 0;
      const bRate = parseInt(b.tbr) || 0;
      return aRate - bRate;
    });
    const middleAudio = audioFormats[Math.floor(audioFormats.length / 2)];
    result.push(middleAudio);
  }

  return result;
}

function convertToBytes(sizeString) {
  if (!sizeString) return NaN;
  
  const units = {
    'KiB': 1024,
    'MiB': 1024 * 1024,
    'GiB': 1024 * 1024 * 1024
  };

  const match = sizeString.match(/^([\d.]+)\s*(KiB|MiB|GiB)?$/i);
  if (!match) return NaN;

  const value = parseFloat(match[1]);
  const unit = match[2];

  if (!unit) return value;
  return value * (units[unit] || 1);
}

app.post('/download', async (req, res) => {
  try {
    const { url, format_id, tipo, custom_name } = req.body;

    if (!url) throw new Error('URL é obrigatória');
    if (!format_id && tipo !== 'audio_only') throw new Error('Formato é obrigatório para vídeo');

    if (url.includes('list=') && !url.includes('watch?')) {
      throw new Error('Parece ser uma playlist. Selecione "Playlist Inteira" no aplicativo.');
    }

    console.log(`${colors.cyan}▶️ Iniciando download: ${url}${colors.reset}`);
    console.log(`${colors.yellow}ℹ️ Tipo: ${tipo} | Formato: ${format_id || 'auto'}${colors.reset}`);

    const args = [
      '-o', custom_name ? `downloads/${custom_name}.%(ext)s` : 'downloads/%(title)s.%(ext)s',
      '--no-warnings',
      '--embed-thumbnail',
      '--embed-metadata',
      '--no-playlist'
    ];

    if (tipo === 'audio_only') {
      args.push(
        '-x',
        '-f', 'bestaudio',
        '--audio-format', 'aac',
        '--postprocessor-args', 'ffmpeg:-c:a aac -b:a 192k'
      );
    } else {
      args.push(
        '-f', `${format_id}+bestaudio`,
        '--merge-output-format', 'mp4',
        '--audio-format', 'aac',
        '--force-keyframes-at-cuts',
        '--postprocessor-args', 'ffmpeg:-c:a aac -b:a 192k'
      );
    }

    args.push(url);

    const result = await new Promise((resolve, reject) => {
      const downloader = spawn('yt-dlp', args);
      setupProgressLogger(downloader);

      let output = '';
      let errorOutput = '';

      downloader.stdout.on('data', (data) => output += data.toString());
      downloader.stderr.on('data', (data) => errorOutput += data.toString());

      downloader.on('close', (code) => {
        if (code !== 0) {
          return reject(new Error(errorOutput || `Download falhou com código ${code}`));
        }
        resolve(output);
      });

      downloader.on('error', (err) => reject(err));
    });

    console.log(`${colors.green}✔️ Download concluído com sucesso!${colors.reset}`);

    res.json({ 
      success: true,
      message: 'Download concluído com sucesso!',
      details: result
    });
  } catch (error) {
    console.error(`${colors.red}✖ Erro em /download:${colors.reset}`, error);
    res.status(500).json({ 
      success: false,
      error: 'Falha no download',
      details: error.message
    });
  }
});




const PORT = 3000;
app.listen(PORT, () => console.log(`\n${colors.green}🚀 Servidor rodando na porta ${PORT}${colors.reset}\n`));