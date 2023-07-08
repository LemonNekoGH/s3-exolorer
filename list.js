if (typeof S3_REGION != 'undefined') {
  var BUCKET_URL = location.protocol + '//' + location.hostname + '.' + S3_REGION + '.amazonaws.com'; // e.g. just 's3' for us-east-1 region
  var BUCKET_WEBSITE_URL = location.protocol + '//' + location.hostname;
}

let S3BL_IGNORE_PATH = true
let S3B_SORT = 'DEFAULT'

if (typeof BUCKET_URL == 'undefined') {
  var BUCKET_URL = location.protocol + '//' + location.hostname;
}

if (typeof BUCKET_NAME != 'undefined') {
  // if bucket_url does not start with bucket_name,
  // assume path-style url
  if (!~BUCKET_URL.indexOf(location.protocol + '//' + BUCKET_NAME)) {
    BUCKET_URL += '/' + BUCKET_NAME;
  }
}

if (typeof BUCKET_WEBSITE_URL == 'undefined') {
  var BUCKET_WEBSITE_URL = BUCKET_URL;
}

if (typeof S3B_ROOT_DIR == 'undefined') {
  var S3B_ROOT_DIR = '';
}

if (typeof EXCLUDE_FILE == 'undefined') {
  var EXCLUDE_FILE = [];
} else if (typeof EXCLUDE_FILE == 'string' || EXCLUDE_FILE instanceof RegExp) {
  var EXCLUDE_FILE = [EXCLUDE_FILE];
}

function createS3QueryUrl(marker) {
  var s3_rest_url = BUCKET_URL;
  s3_rest_url += '?delimiter=/';

  //
  // Handling paths and prefixes:
  //
  // 1. S3BL_IGNORE_PATH = false
  // Uses the pathname
  // {bucket}/{path} => prefix = {path}
  //
  // 2. S3BL_IGNORE_PATH = true
  // Uses ?prefix={prefix}
  //
  // Why both? Because we want classic directory style listing in normal
  // buckets but also allow deploying to non-buckets
  //

  var rx = '.*[?&]prefix=' + S3B_ROOT_DIR + '([^&]+)(&.*)?$';
  var prefix = '';
  if (S3BL_IGNORE_PATH == false) {
    var prefix = location.pathname.replace(/^\//, S3B_ROOT_DIR);
  }
  var match = location.search.match(rx);
  if (match) {
    prefix = S3B_ROOT_DIR + match[1];
  } else {
    if (S3BL_IGNORE_PATH) {
      var prefix = S3B_ROOT_DIR;
    }
  }
  if (prefix) {
    // make sure we end in /
    var prefix = prefix.replace(/\/$/, '') + '/';
    s3_rest_url += '&prefix=' + prefix;
  }
  if (marker) {
    s3_rest_url += '&marker=' + marker;
  }
  return s3_rest_url;
}

const { createApp, ref, onMounted, computed } = Vue
createApp({
  setup() {
    const info = ref({
      directories: [],
      files: []
    })

    const fetchData = async (marker, prev) => {
      // fetch data
      const api = createS3QueryUrl()
      const dataStr = await fetch(api)
        .then(res => res.text())
      const data = (new XMLParser()).parse(dataStr)
      console.log(data.ListBucketResult)
      // change base
      let base = window.location.href
      base = (base.endsWith('/')) ? base : base + '/';
      const baseEl = document.createElement('base')
      baseEl.href = base
      document.head.appendChild(baseEl)
      // get info
      let objInfo = getInfoFromS3Data(data.ListBucketResult)

      // prepend prev
      if (typeof prev !== 'undefined') {
        objInfo.files = objInfo.files.concat(prev.files)
        objInfo.directories = objInfo.directories.concat(prev.directories)
      }

      // get next
      if (objInfo.nextMarker != "null") {
        fetchData(objInfo.nextMarker, objInfo);
      } else {
        // Slight modification by FuzzBall03
        // This will sort your file listing based on var S3B_SORT
        // See url for example:
        // http://esp-link.s3-website-us-east-1.amazonaws.com/
        if (S3B_SORT != 'DEFAULT') {
          objInfo.files.sort(sortFunction);
          objInfo.directories.sort(sortFunction);
        }
      }

      info.value = objInfo
    }

    onMounted(() => fetchData())

    const items = computed(() => {
      console.log(info.value)

      const ret = []
      const prefix = info.value.prefix ?? ''
      // back to up dir
      const upDir = prefix.substring(0, prefix.lastIndexOf('/', prefix.length - 2)) + '/'
      console.log(upDir)
      console.log(prefix.lastIndexOf('/', prefix.length - 2))
      // cannot back to up dir when prefix === root
      if (upDir != '' && prefix !== S3B_ROOT_DIR) {
        ret.push({
          LastModified: '',
          Size: '',
          Key: '..',
          Url: location.protocol + '//' + location.hostname + location.pathname + '?prefix=' + upDir,
        })
      }

      info.value.directories.forEach(it => {
        const keyText = it.Key.substring(prefix.length)
        let url = location.protocol + '//' + location.hostname + location.pathname + '?prefix=' + encodePath(it.Key)
        ret.push({
          LastModified: it.LastModified,
          Size: it.Size,
          Key: keyText,
          Url: url,
        })
      })

      info.value.files.forEach(it => {
        const keyText = it.Key.substring(prefix.length)
        let url = location.protocol + '//' + location.hostname + '/' + encodePath(it.Key)
        ret.push({
          LastModified: it.LastModified,
          Size: it.Size,
          Key: keyText,
          Url: url,
        })
      })

      return ret
    })

    return {
      items
    }
  }
}).mount("#app")

// This will sort your file listing by most recently modified.
// Flip the comparator to '>' if you want oldest files first.
function sortFunction(a, b) {
  switch (S3B_SORT) {
    case "OLD2NEW":
      return a.LastModified > b.LastModified ? 1 : -1;
    case "NEW2OLD":
      return a.LastModified < b.LastModified ? 1 : -1;
    case "A2Z":
      return a.Key > b.Key ? 1 : -1;
    case "Z2A":
      return a.Key < b.Key ? 1 : -1;
    case "BIG2SMALL":
      return a.Size < b.Size ? 1 : -1;
    case "SMALL2BIG":
      return a.Size > b.Size ? 1 : -1;
  }
}

function getInfoFromS3Data(data) {
  let prefix = data.Prefix
  let files = []

  if (data.Contents) {
    if (data.Contents.map) {
      files = data.Contents.map(it => ({
        Key: it.Key,
        LastModified: it.LastModified,
        Size: bytesToHumanReadable(it.Size),
        Type: 'file',
      }))
    } else {
      files = [{
        Key: data.Contents.Key,
        LastModified: data.Contents.LastModified,
        Size: bytesToHumanReadable(data.Contents.Size),
        Type: 'file',
      }]
    }
  }

  // remove the prefix if exists
  if (prefix && files[0] && files[0].Key == prefix) {
    files.shift();
  }

  let directories = []

  if (data.CommonPrefixes) {
    if (data.CommonPrefixes.map) {
      directories = data.CommonPrefixes.map(it => ({
        Key: it.Prefix,
        LastModified: '',
        Size: '0',
        Type: 'directory',
      }))
    } else {
      directories = [{
        Key: data.CommonPrefixes.Prefix,
        LastModified: '',
        Size: '0',
        Type: 'directory',
      }]
    }
  }

  let nextMarker = null

  if (data.IsTruncated) {
    nextMarker = data.NextMarker
  }

  // clang-format off
  return {
    files: files,
    directories: directories,
    prefix: prefix,
    nextMarker: encodeURIComponent(nextMarker)
  }
  // clang-format on
}

// Encode everything but "/" which are significant in paths and to S3
function encodePath(path) {
  return encodeURIComponent(path).replace(/%2F/g, '/')
}

function bytesToHumanReadable(sizeInBytes) {
  var i = -1;
  var units = [' kB', ' MB', ' GB'];
  do {
    sizeInBytes = sizeInBytes / 1024;
    i++;
  } while (sizeInBytes > 1024);
  return Math.max(sizeInBytes, 0.1).toFixed(1) + units[i];
}
