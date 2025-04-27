const express = require('express');
const { spawn } = require('child_process');
const cors = require('cors');
const app = express();

app.use(express.json());
app.use(cors());

app.post('/get-formats', async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url) throw new Error('URL é obrigatória');
    if (!url.match(/youtube\.com|youtu\.be/)) throw new Error('URL do YouTube inválida');

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

    res.json({ formats: processedFormats });
  } catch (error) {
    console.error('Erro em /get-formats:', error);
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

    const args = [
      '-o', custom_name ? `downloads/${custom_name}.%(ext)s` : 'downloads/%(title)s.%(ext)s',
      '--no-warnings',
      '--embed-thumbnail',
      '--embed-metadata'
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

    res.json({ 
      success: true,
      message: 'Download concluído com sucesso!',
      details: result
    });
  } catch (error) {
    console.error('Erro em /download:', error);
    res.status(500).json({ 
      success: false,
      error: 'Falha no download',
      details: error.message
    });
  }
});

const PORT = 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));