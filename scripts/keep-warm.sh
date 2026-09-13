#!/bin/bash
# Keep the QCU Apps Script deployment warm to avoid 60-100s cold starts.
curl -s -L --max-time 120 -o /dev/null "https://script.google.com/macros/s/AKfycbxT7OPntJl2B_kJPMLuVqxHI2sUQGdtL9M1IRMtVdj9nBCZqj1KTbj2cVrZzfqaP0Xggw/exec?action=health"
